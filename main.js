'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, powerMonitor, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { Vault } = require('./src/vault');
const { autoUpdater } = require('electron-updater');

app.setAppUserModelId('com.daybook.journal');
if (!app.requestSingleInstanceLock()) { app.quit(); }

const DATA_DIR = process.env.DAYBOOK_DATA_DIR || path.join(app.getPath('userData'), 'journal');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const vault = new Vault(DATA_DIR);
let win = null;
let quitting = false;

const DEFAULT_SETTINGS = { autoLockMinutes: 10, lockOnMinimize: false, theme: 'system', fontSize: 19, spellcheck: true };

function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const clean = { ...readSettings() };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in s && typeof s[k] === typeof DEFAULT_SETTINGS[k]) clean[k] = s[k];
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(clean, null, 2));
  nativeTheme.themeSource = ['light', 'dark'].includes(clean.theme) ? clean.theme : 'system';
  if (win) win.webContents.session.setSpellCheckerEnabled(!!clean.spellcheck);
  return clean;
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
    title: 'Daybook',
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
    const t = setTimeout(() => { quitting = true; vault.lock(); win.close(); }, 2500);
    ipcMain.once('app:flushed', () => { clearTimeout(t); quitting = true; vault.lock(); win.close(); });
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

handle('vault:status', () => ({ exists: vault.exists(), unlocked: vault.isUnlocked(), dataDir: DATA_DIR }));
handle('vault:create', pw => { vault.create(pw); return true; });
handle('vault:unlock', pw => vault.unlock(pw));
handle('vault:lock', () => { vault.lock(); return true; });
handle('vault:changePassword', (a, b) => { vault.changePassword(a, b); return true; });
handle('entries:list', () => vault.list());
handle('entries:get', id => vault.get(id));
handle('entries:save', e => vault.save(e));
handle('entries:remove', id => { vault.remove(id); return true; });
handle('settings:get', () => readSettings());
handle('settings:set', s => writeSettings(s || {}));
handle('app:showDataFolder', () => { shell.openPath(DATA_DIR); return true; });

handle('backup:export', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const r = await dialog.showSaveDialog(win, {
    title: 'Save encrypted backup',
    defaultPath: path.join(app.getPath('documents'), `Daybook backup ${stamp}.daybook`),
    filters: [{ name: 'Daybook backup', extensions: ['daybook'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return { count: vault.exportBackup(r.filePath), file: r.filePath };
});

async function pickBackup() {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a Daybook backup', properties: ['openFile'],
    filters: [{ name: 'Daybook backup', extensions: ['daybook'] }],
  });
  return r.canceled ? null : r.filePaths[0];
}
handle('backup:pick', pickBackup);
handle('backup:import', (file, pw) => vault.importBackup(file, pw));
handle('backup:restoreFresh', (file, pw) => vault.restoreFresh(file, pw));

handle('export:readable', async () => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export a readable copy',
    defaultPath: path.join(app.getPath('documents'), 'Daybook journal.html'),
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
handle('app:version', () => ({ version: app.getVersion(), updateReady }));
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
  const lockAll = () => { if (win && vault.isUnlocked()) win.webContents.send('app:lock'); };
  powerMonitor.on('lock-screen', lockAll);
  powerMonitor.on('suspend', lockAll);
});

app.on('before-quit', () => { vault.lock(); });
app.on('window-all-closed', () => app.quit());

module.exports = { getWindow: () => win, vault };
