'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerMonitor, nativeTheme, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { migrateJournal } = require('./src/migrate');
const { createBackend, stripActive } = require('./src/backend');

app.setAppUserModelId('com.daybook.journal'); // kept from the Daybook days so updates and pins carry over
if (!app.requestSingleInstanceLock()) { app.quit(); }

const DATA_DIR = process.env.WELLWRITE_DATA_DIR || process.env.DAYBOOK_DATA_DIR || path.join(app.getPath('userData'), 'journal');
// Bring the journal across from when the app was called Daybook.
if (!process.env.WELLWRITE_DATA_DIR && !process.env.DAYBOOK_DATA_DIR) {
  try { migrateJournal(path.join(app.getPath('appData'), 'Daybook', 'journal'), DATA_DIR); }
  catch (e) { console.error('Journal move failed:', e); }
}
function loadGoogleConfig() {
  const id = process.env.WELLWRITE_GOOGLE_CLIENT_ID || process.env.DAYBOOK_GOOGLE_CLIENT_ID;
  if (id) {
    return { clientId: id, clientSecret: process.env.WELLWRITE_GOOGLE_CLIENT_SECRET || process.env.DAYBOOK_GOOGLE_CLIENT_SECRET || '' };
  }
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'google-config.json'), 'utf8')); } catch { return null; }
}
const canProtect = () => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
let win = null;
let quitting = false;

const backend = createBackend({
  dataDir: DATA_DIR,
  tmpDir: app.getPath('temp'),
  canProtect,
  protect: s => safeStorage.encryptString(s).toString('base64'),
  unprotect: s => safeStorage.decryptString(Buffer.from(s, 'base64')),
  // "Remember my password" and saved keys are only offered where Windows can protect them.
  testTrust: process.env.WELLWRITE_TEST_TRUST === '1' && !app.isPackaged,
  fetch: (...a) => (app.isReady() ? net.fetch(...a) : fetch(...a)),
  send: (event, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(event, ...args); },
  openBrowser: url => shell.openExternal(url),
  onSettings: clean => {
    nativeTheme.themeSource = ['light', 'dark'].includes(clean.theme) ? clean.theme : 'system';
    if (win) win.webContents.session.setSpellCheckerEnabled(!!clean.spellcheck);
  },
  googleConfig: loadGoogleConfig(),
  apiBibleBase: process.env.WELLWRITE_APIBIBLE_URL || null,
  logFile: path.join(app.getPath('userData'), 'logs', 'wellwrite.log'),
  // Tests: a stand-in for Google's servers (never in the installed app).
  googleBase: !app.isPackaged ? process.env.WELLWRITE_GOOGLE_URL || null : null,
  picturesUrl: process.env.WELLWRITE_PICTURES_URL || null,
});
const { vault, backups, readSettings, writeSettings, backupInfo, suggestFolders } = backend;

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

  // Problems log: page errors and freezes go to <userData>/logs/wellwrite.log (newest 200 KB), so a bug
  // report can say what actually happened. Only error messages are written, never your entries.
  const logFile = path.join(app.getPath('userData'), 'logs', 'wellwrite.log');
  const logLine = msg => {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      try { if (fs.statSync(logFile).size > 200 * 1024) fs.renameSync(logFile, logFile + '.old'); } catch {}
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${app.getVersion()} ${String(msg).slice(0, 600)}\n`);
    } catch {}
  };
  win.webContents.on('console-message', (...a) => {
    const e = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2], lineNumber: a[3], sourceId: a[4] };
    const lvl = e.level;
    if (lvl === 'error' || lvl === 3) logLine(`error: ${e.message} (${path.basename(String(e.sourceId || ''))}:${e.lineNumber || ''})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => { logLine(`page stopped: ${d.reason}`); if (d.reason !== 'clean-exit') win.reload(); });
  // If the page stops responding (nothing can be clicked, Esc does nothing), offer to reload it. Entries save as you
  // type, so at most the last second of typing is lost; the journal locks and asks for your password as usual.
  let hungAsk = false;
  win.on('unresponsive', async () => {
    logLine('page not responding');
    if (hungAsk) return; hungAsk = true;
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Reload WellWrite', 'Wait'], defaultId: 0, cancelId: 1,
      title: 'WellWrite isn’t responding', message: 'WellWrite has stopped responding.', detail: 'Reloading opens it again at the lock screen. Your entries are saved as you type.' });
    hungAsk = false;
    if (r.response === 0) win.webContents.forcefullyCrashRenderer();
  });
  win.on('responsive', () => logLine('page responding again'));
  ipcMain.removeHandler('app:showLog');
  ipcMain.handle('app:showLog', () => { logLine('log opened'); shell.showItemInFolder(logFile); return true; });

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
// Everything shared with the Android app; the rest below needs Windows (dialogs, the browser, updates).
for (const [name, fn] of backend.handlers) handle(name, fn);

handle('wp:open', url => { if (backend.wpLinkOk(url)) shell.openExternal(url); return true; });
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
handle('readings:pickFile', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose your readings file', properties: ['openFile'],
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return backend.setReadingsFile(r.filePaths[0]);
});

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
handle('app:version', () => ({ version: backend.version, updateReady }));
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

handle('backup:chooseFolder', async suggested => {
  let dir = null;
  const ok = suggestFolders().find(f => f.path === suggested);
  if (ok) dir = ok.path;
  else {
    const r = await dialog.showOpenDialog(win, { title: 'Choose a backup folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return backupInfo();
    dir = r.filePaths[0];
  }
  return backend.setBackupFolder(dir);
});
handle('backup:showFolder', () => { const d = readSettings().backupDir; if (d) shell.openPath(d); return true; });
handle('google:connect', async () => {
  const info = await backend.connectGoogle();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  return info;
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
  setupUpdates();
  backend.startTimers();
  const lockAll = () => { if (win && vault.isUnlocked()) win.webContents.send('app:lock'); };
  powerMonitor.on('lock-screen', lockAll);
  powerMonitor.on('suspend', lockAll);
});

app.on('before-quit', () => { vault.lock(); });
app.on('window-all-closed', () => app.quit());

module.exports = { getWindow: () => win, vault };
