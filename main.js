'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerMonitor, nativeTheme, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { Vault } = require('./src/vault');
const { ApiBible } = require('./src/apibible');
const { BOOKS } = require('./src/bible-books');
const { autoUpdater } = require('electron-updater');
const { migrateJournal } = require('./src/migrate');
const bible = require('./src/bible');
const { Trust } = require('./src/trust');
const { GoogleDrive } = require('./src/gdrive');
const { BackupManager, suggestFolders } = require('./src/backup');

app.setAppUserModelId('com.daybook.journal'); // kept from the Daybook days so updates and pins carry over
if (!app.requestSingleInstanceLock()) { app.quit(); }

const DATA_DIR = process.env.WELLWRITE_DATA_DIR || process.env.DAYBOOK_DATA_DIR || path.join(app.getPath('userData'), 'journal');
// Bring the journal across from when the app was called Daybook.
if (!process.env.WELLWRITE_DATA_DIR && !process.env.DAYBOOK_DATA_DIR) {
  try { migrateJournal(path.join(app.getPath('appData'), 'Daybook', 'journal'), DATA_DIR); }
  catch (e) { console.error('Journal move failed:', e); }
}
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const vault = new Vault(DATA_DIR);
let win = null;
let quitting = false;

const DEFAULT_SETTINGS = {
  autoLockMinutes: 10, lockOnMinimize: false, theme: 'system', fontSize: 19, spellcheck: true, showQuote: true, dailyCard: 'both', quoteFrom: '', quotePlan: 'christian', builtinReadings: true, readingsFile: '', weekPictures: true, shownBoth: true,
  backupToGoogle: false, backupToFolder: false, backupDir: '', backupEvery: 'daily', backupKeep: 10, backupNudgeDismissed: false,
};
const CHOICES = {
  theme: ['system', 'light', 'dark'],
  backupEvery: ['daily', 'weekly', 'close'],
  backupKeep: [5, 10, 30, 0],
  dailyCard: ['quote', 'verse', 'both', 'none'],
  quotePlan: ['christian', 'spiritual', 'off'],
};

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
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const clean = { ...readSettings() };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in s) || typeof s[k] !== typeof DEFAULT_SETTINGS[k]) continue;
    if ((k === 'backupDir' || k === 'readingsFile') && !internal) continue; // only set through the pickers
    if (CHOICES[k] && !CHOICES[k].includes(s[k])) continue;
    clean[k] = s[k];
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(clean, null, 2));
  nativeTheme.themeSource = ['light', 'dark'].includes(clean.theme) ? clean.theme : 'system';
  if (win) win.webContents.session.setSpellCheckerEnabled(!!clean.spellcheck);
  return clean;
}

// ---------- backups ----------
function loadGoogleConfig() {
  const id = process.env.WELLWRITE_GOOGLE_CLIENT_ID || process.env.DAYBOOK_GOOGLE_CLIENT_ID;
  if (id) {
    return { clientId: id, clientSecret: process.env.WELLWRITE_GOOGLE_CLIENT_SECRET || process.env.DAYBOOK_GOOGLE_CLIENT_SECRET || '' };
  }
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'google-config.json'), 'utf8')); } catch { return null; }
}
const canProtect = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
// "Remember my password". Only offered where Windows can protect the saved key.
const testTrust = process.env.WELLWRITE_TEST_TRUST === '1' && !app.isPackaged;
const trust = new Trust({
  file: path.join(DATA_DIR, 'trusted.json'),
  available: () => canProtect() || testTrust,
  protect: t => (canProtect() ? 'os:' + safeStorage.encryptString(t).toString('base64') : 'test:' + t),
  unprotect: t => (t.startsWith('os:') ? safeStorage.decryptString(Buffer.from(t.slice(3), 'base64')) : testTrust ? t.replace(/^test:/, '') : ''),
});

const drive = new GoogleDrive({
  config: loadGoogleConfig(),
  storeFile: path.join(DATA_DIR, 'google.json'),
  protect: t => (canProtect() ? 'os:' + safeStorage.encryptString(t).toString('base64') : 'plain:' + Buffer.from(t).toString('base64')),
  unprotect: t => (t.startsWith('os:') ? safeStorage.decryptString(Buffer.from(t.slice(3), 'base64')) : Buffer.from(t.replace(/^plain:/, ''), 'base64').toString()),
  openBrowser: url => shell.openExternal(url),
  fetch: (...a) => (app.isReady() ? net.fetch(...a) : fetch(...a)),
});
const backups = new BackupManager({
  vault, dataDir: DATA_DIR, drive, getSettings: readSettings, tmpDir: app.getPath('temp'),
  onResult: r => { if (win && !win.isDestroyed()) win.webContents.send('backup:result', publicResult(r)); },
});
const publicResult = r => ({ ok: r.ok, reason: r.reason, error: r.error || '', code: r.code || '', count: r.count, where: r.where || '' });

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

function stripActive(html) {
  // Defence in depth for the readable export; the editor already sanitises.
  return String(html)
    .replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '');
}

function createWindow() {
  const settings = readSettings();
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 820, minHeight: 560,
    title: 'WellWrite',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141a28' : '#1d2a47',
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      devTools: !app.isPackaged,
    },
  });
  win.webContents.session.setSpellCheckerEnabled(!!settings.spellcheck);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  // Never navigate away or open new windows; send web links to the real browser.
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Right-click menu with spelling suggestions.
  win.webContents.on('context-menu', (_e, p) => {
    const items = [];
    for (const s of p.dictionarySuggestions.slice(0, 6)) items.push({ label: s, click: () => win.webContents.replaceMisspelling(s) });
    if (p.misspelledWord) {
      items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle', label: 'Paste as plain text' }, { type: 'separator' }, { role: 'selectAll' });
    else if (p.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Ask the page to save before the window closes.
  win.on('close', e => {
    if (quitting || !vault.isUnlocked()) return;
    e.preventDefault();
    win.webContents.send('app:flush');
    let finished = false;
    const finish = async () => {
      if (finished) return; finished = true;
      quitting = true;
      vault.lock();
      if (backups.isDue('close')) {
        win.hide();
        await Promise.race([backups.run('close'), new Promise(r => setTimeout(r, 45000))]).catch(() => {});
      }
      win.close();
    };
    const t = setTimeout(finish, 2500);
    ipcMain.once('app:flushed', () => { clearTimeout(t); finish(); });
  });

  win.on('minimize', () => {
    if (readSettings().lockOnMinimize && vault.isUnlocked()) win.webContents.send('app:lock');
  });
}

// ---------- IPC ----------
function handle(name, fn) {
  ipcMain.handle(name, async (e, ...args) => {
    if (!win || e.sender !== win.webContents) throw new Error('Unknown sender');
    try { return { ok: true, value: await fn(...args) }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

handle('vault:status', () => ({ exists: vault.exists(), unlocked: vault.isUnlocked(), dataDir: DATA_DIR, trust: trust.status() }));
handle('vault:create', pw => { vault.create(pw); return true; });
handle('vault:unlock', pw => {
  const ok = vault.unlock(pw);
  if (ok) {
    try { trust.refresh(vault.key); } catch {}
    setTimeout(() => backups.maybeRun('unlock').catch(() => {}), 5000);
  }
  return ok;
});
handle('vault:unlockTrusted', () => {
  if (vault.isUnlocked()) return true;
  if (!vault.exists()) return false;
  const key = trust.key();
  if (!key) return false;
  vault.unlockWithKey(key);
  setTimeout(() => backups.maybeRun('unlock').catch(() => {}), 5000);
  return true;
});
handle('vault:setTrust', mode => trust.save(mode, vault.key));
handle('vault:lock', () => { vault.lock(); return true; });
handle('vault:changePassword', (a, b) => { vault.changePassword(a, b); return true; });
handle('entries:list', () => vault.list());
handle('entries:get', id => vault.get(id));
handle('entries:save', e => vault.save(e));
handle('entries:remove', id => { vault.remove(id); return true; });
handle('categories:get', () => vault.getMeta().categories);
handle('categories:set', list => vault.setCategories(list).categories);
handle('categories:move', (fromId, toId) => vault.recategorize(fromId, toId || ''));
// ---------- Bible versions: WEB and KJV built in; more from API.Bible with your own key ----------
const apiBible = new ApiBible({
  file: path.join(DATA_DIR, 'apibible.json'),
  available: () => process.env.WELLWRITE_TEST_TRUST === '1' || safeStorage.isEncryptionAvailable(),
  protect: s => process.env.WELLWRITE_TEST_TRUST === '1' ? 't:' + Buffer.from(s).toString('base64') : safeStorage.encryptString(s).toString('base64'),
  unprotect: s => s.startsWith('t:') ? Buffer.from(s.slice(2), 'base64').toString() : safeStorage.decryptString(Buffer.from(s, 'base64')),
  fetch: (url, opts) => net.fetch(url, opts),
  ...(process.env.WELLWRITE_APIBIBLE_URL ? { base: process.env.WELLWRITE_APIBIBLE_URL, fums: process.env.WELLWRITE_APIBIBLE_URL + '/fums' } : {}),
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
handle('bible:verses', (refs, translation) => Promise.all((Array.isArray(refs) ? refs.slice(0, 20) : []).map(r => verseIn(String(r), translation))));
handle('apibible:status', () => apiBible.status());
handle('apibible:setKey', key => apiBible.setKey(key));
handle('apibible:forget', () => { const st = vault.isUnlocked() ? vault.getBible() : null; if (st && apiId(st.translation)) vault.setBible({ ...st, translation: 'web' }); return apiBible.forget(); });
handle('apibible:list', language => apiBible.list(typeof language === 'string' ? language.slice(0, 8) : 'eng'));
handle('apibible:setVersions', list => {
  const r = apiBible.setVersions(list);
  const st = vault.isUnlocked() ? vault.getBible() : null;   // a version you removed can't stay chosen
  if (st && apiId(st.translation) && !r.versions.some(v => v.id === apiId(st.translation))) vault.setBible({ ...st, translation: 'web' });
  return r;
});
// A picture for each week: WellWrite's own choice (public-domain art and photos, fetched once from Wikimedia
// Commons and then kept, encrypted, in the journal), or one you choose.
const DEFAULT_PICTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'pictures.json'), 'utf8'));
const pictureUrl = file => (process.env.WELLWRITE_PICTURES_URL || 'https://commons.wikimedia.org/wiki/Special:FilePath/{file}?width=1800')
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
    const res = await net.fetch(pictureUrl(d.file), { headers: { 'User-Agent': `WellWrite/${APP_VERSION} (https://github.com/chrisgribbs/Diary)` } });
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
handle('quotes:get', () => vault.getQuotes());
handle('quotes:set', list => vault.setQuotes(list));
handle('quotes:export', async text => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Save your quotes', defaultPath: path.join(app.getPath('documents'), 'WellWrite quotes.txt'),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, '\uFEFF' + String(text).replace(/\n/g, '\r\n'));
  return r.filePath;
});
// Read a text file the person picks (e.g. Kindle's "My Clippings.txt") so quotes can be imported from it.
handle('quotes:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a text file of quotes, or your Kindle “My Clippings.txt”', properties: ['openFile'],
    filters: [{ name: 'Text', extensions: ['txt', 'md', 'csv'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const st = fs.statSync(r.filePaths[0]);
  if (st.size > 25 * 1024 * 1024) throw new Error('That file is too large to import');
  return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8').replace(/^\uFEFF/, '') };
});
// ---------- reading packs ----------
// Built in: psalms, poems and reflections that ship with WellWrite.
handle('readings:builtin', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'readings', 'wellwrite.json'), 'utf8'));
  return { name: p.name, version: p.version, items: p.items, retired: p.retired };
});
// Your readings file: chosen once, read again whenever it changes.
let readingsWatch = null;
function watchReadings() {
  if (readingsWatch) { fs.unwatchFile(readingsWatch); readingsWatch = null; }
  const f = readSettings().readingsFile;
  if (!f) return;
  readingsWatch = f;
  fs.watchFile(f, { interval: 4000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs && win && !win.isDestroyed() && vault.isUnlocked()) win.webContents.send('readings:changed');
  });
}
handle('readings:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose your readings file', properties: ['openFile'],
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  writeSettings({ readingsFile: r.filePaths[0] }, { internal: true });
  watchReadings();
  return r.filePaths[0];
});
handle('readings:forgetFile', () => { writeSettings({ readingsFile: '' }, { internal: true }); watchReadings(); return true; });
handle('readings:readFile', () => {
  const f = readSettings().readingsFile;
  if (!f) return null;
  if (!fs.existsSync(f)) return { name: path.basename(f), path: f, missing: true };
  const st = fs.statSync(f);
  if (st.size > 25 * 1024 * 1024) throw new Error('Your readings file is too large');
  return { name: path.basename(f), path: f, modified: st.mtime.toISOString(), text: fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '') };
});
handle('readings:sync', (packId, items, retired) => vault.syncPack(String(packId), items, retired));

handle('settings:get', () => readSettings());
handle('settings:set', s => writeSettings(s || {}));
handle('app:showDataFolder', () => { shell.openPath(DATA_DIR); return true; });

handle('backup:export', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: 'Save encrypted backup',
    defaultPath: path.join(app.getPath('documents'), `WellWrite backup ${stamp}.wellwrite`),
    filters: [{ name: 'WellWrite backup', extensions: ['wellwrite'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return { count: vault.exportBackup(r.filePath), file: r.filePath };
});

async function pickBackup() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a WellWrite backup', properties: ['openFile'],
    filters: [{ name: 'WellWrite backup', extensions: ['wellwrite', 'daybook'] }, { name: 'All files', extensions: ['*'] }],
  });
  return r.canceled ? null : r.filePaths[0];
}
handle('backup:pick', pickBackup);
handle('backup:import', (file, pw) => vault.importBackup(file, pw));
handle('backup:restoreFresh', (file, pw) => vault.restoreFresh(file, pw));

handle('export:readable', async () => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export a readable copy',
    defaultPath: path.join(app.getPath('documents'), 'WellWrite journal.html'),
    filters: [{ name: 'Web page', extensions: ['html'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return { count: vault.exportReadable(r.filePath, stripActive), file: r.filePath };
});

// ---------- updates ----------
let updateReady = null;
function setupUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return; // portable build can't self-update
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    updateReady = info.version;
    if (win) win.webContents.send('app:update-ready', info.version);
  });
  autoUpdater.on('error', () => { /* offline or no releases yet: try again later */ });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 8000);
  setInterval(check, 6 * 60 * 60 * 1000);
}
const APP_VERSION = require('./package.json').version;
handle('app:version', () => ({ version: APP_VERSION, updateReady }));
handle('app:checkUpdates', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  if (updateReady) return { status: 'ready', version: updateReady };
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    return v && v !== app.getVersion() ? { status: 'downloading', version: v } : { status: 'latest' };
  } catch { return { status: 'offline' }; }
});
handle('app:installUpdate', () => {
  quitting = true;
  vault.lock();
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
});

handle('backup:info', () => backupInfo());
handle('backup:now', async () => publicResult(await backups.run('manual')));
handle('backup:chooseFolder', async suggested => {
  let dir = null;
  const ok = suggestFolders().find(f => f.path === suggested);
  if (ok) dir = ok.path;
  else {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a backup folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return backupInfo();
    dir = r.filePaths[0];
  }
  if (path.resolve(dir).startsWith(path.resolve(DATA_DIR))) throw new Error("Choose a folder outside WellWrite's own journal folder");
  writeSettings({ backupDir: dir, backupToFolder: true }, { internal: true });
  backups.maybeRun('connected').catch(() => {});
  return backupInfo();
});
handle('backup:showFolder', () => { const d = readSettings().backupDir; if (d) shell.openPath(d); return true; });
handle('google:connect', async () => {
  await drive.connect();
  writeSettings({ backupToGoogle: true });
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  backups.maybeRun('connected').catch(() => {});
  return backupInfo();
});
handle('google:cancel', () => { drive.cancelConnect(); return true; });
handle('google:disconnect', async () => { await drive.disconnect(); return backupInfo(); });
handle('google:list', () => drive.list());
async function downloadDriveBackup(id) {
  const tmp = path.join(app.getPath('temp'), `wellwrite-restore-${Date.now()}.wellwrite`);
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

handle('shell:openExternal', url => {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(url);
  return true;
});

// ---------- lifecycle ----------
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  watchReadings();
  setupUpdates();
  setTimeout(() => backups.maybeRun('start').catch(() => {}), 60000);
  setInterval(() => backups.maybeRun('timer').catch(() => {}), 30 * 60000);
  const lockAll = () => { if (win && vault.isUnlocked()) win.webContents.send('app:lock'); };
  powerMonitor.on('lock-screen', lockAll);
  powerMonitor.on('suspend', lockAll);
});

app.on('before-quit', () => { vault.lock(); });
app.on('window-all-closed', () => app.quit());

module.exports = { getWindow: () => win, vault };
