'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(name, ...args) {
  const r = await ipcRenderer.invoke(name, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

contextBridge.exposeInMainWorld('wellwrite', {
  status: () => call('vault:status'),
  create: pw => call('vault:create', pw),
  unlock: pw => call('vault:unlock', pw),
  lock: () => call('vault:lock'),
  unlockTrusted: () => call('vault:unlockTrusted'),
  setTrust: mode => call('vault:setTrust', mode),
  changePassword: (a, b) => call('vault:changePassword', a, b),
  list: () => call('entries:list'),
  get: id => call('entries:get', id),
  save: e => call('entries:save', e),
  remove: id => call('entries:remove', id),
  getCategories: () => call('categories:get'),
  setCategories: list => call('categories:set', list),
  moveCategory: (fromId, toId) => call('categories:move', fromId, toId),
  bibleInfo: () => call('bible:info'),
  setBibleState: st => call('bible:setState', st),
  bibleReading: (plan, day, translation) => call('bible:reading', plan, day, translation),
  verseOfDay: (dayNumber, translation) => call('bible:verseOfDay', dayNumber, translation),
  getQuotes: () => call('quotes:get'),
  setQuotes: list => call('quotes:set', list),
  pickQuotesFile: () => call('quotes:pickFile'),
  getSettings: () => call('settings:get'),
  setSettings: s => call('settings:set', s),
  showDataFolder: () => call('app:showDataFolder'),
  exportBackup: () => call('backup:export'),
  pickBackup: () => call('backup:pick'),
  importBackup: (f, pw) => call('backup:import', f, pw),
  restoreFresh: (f, pw) => call('backup:restoreFresh', f, pw),
  exportReadable: () => call('export:readable'),
  openExternal: url => call('shell:openExternal', url),
  backupInfo: () => call('backup:info'),
  backupNow: () => call('backup:now'),
  chooseBackupFolder: suggested => call('backup:chooseFolder', suggested),
  showBackupFolder: () => call('backup:showFolder'),
  googleConnect: () => call('google:connect'),
  googleCancel: () => call('google:cancel'),
  googleDisconnect: () => call('google:disconnect'),
  googleList: () => call('google:list'),
  googleImport: (id, pw) => call('google:import', id, pw),
  googleRestoreFresh: (id, pw) => call('google:restoreFresh', id, pw),
  onBackupResult: fn => ipcRenderer.on('backup:result', (_e, r) => fn(r)),
  version: () => call('app:version'),
  checkUpdates: () => call('app:checkUpdates'),
  installUpdate: () => call('app:installUpdate'),
  onUpdateReady: fn => ipcRenderer.on('app:update-ready', (_e, v) => fn(v)),
  onFlush: fn => ipcRenderer.on('app:flush', async () => { try { await fn(); } finally { ipcRenderer.send('app:flushed'); } }),
  onLock: fn => ipcRenderer.on('app:lock', () => fn()),
});
