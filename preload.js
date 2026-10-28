'use strict';
const { contextBridge, ipcRenderer } = require('electron');

async function call(name, ...args) {
  const r = await ipcRenderer.invoke(name, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

contextBridge.exposeInMainWorld('daybook', {
  status: () => call('vault:status'),
  create: pw => call('vault:create', pw),
  unlock: pw => call('vault:unlock', pw),
  lock: () => call('vault:lock'),
  changePassword: (a, b) => call('vault:changePassword', a, b),
  list: () => call('entries:list'),
  get: id => call('entries:get', id),
  save: e => call('entries:save', e),
  remove: id => call('entries:remove', id),
  getSettings: () => call('settings:get'),
  setSettings: s => call('settings:set', s),
  showDataFolder: () => call('app:showDataFolder'),
  exportBackup: () => call('backup:export'),
  pickBackup: () => call('backup:pick'),
  importBackup: (f, pw) => call('backup:import', f, pw),
  restoreFresh: (f, pw) => call('backup:restoreFresh', f, pw),
  exportReadable: () => call('export:readable'),
  openExternal: url => call('shell:openExternal', url),
  version: () => call('app:version'),
  checkUpdates: () => call('app:checkUpdates'),
  installUpdate: () => call('app:installUpdate'),
  onUpdateReady: fn => ipcRenderer.on('app:update-ready', (_e, v) => fn(v)),
  onFlush: fn => ipcRenderer.on('app:flush', async () => { try { await fn(); } finally { ipcRenderer.send('app:flushed'); } }),
  onLock: fn => ipcRenderer.on('app:lock', () => fn()),
});
