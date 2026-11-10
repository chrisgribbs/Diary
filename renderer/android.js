'use strict';
// WellWrite on Android. The page is the same as on Windows; this file gives it the same `window.wellwrite`
// that preload.js gives it there, but talking to WellWrite's engine (Node.js, running inside the app)
// through the Android app instead of Electron. On Windows this file does nothing.
(() => {
  const native = window.WellWriteNative;
  if (!native || window.wellwrite) return;
  document.documentElement.dataset.platform = 'android';

  // Messages are JSON. Anything outside plain ASCII is written as \uXXXX so it passes safely through Java and C.
  const ascii = s => s.replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  const pending = new Map();
  const listeners = {};
  let seq = Math.floor(Math.random() * 1e9);   // never mistaken for a reply meant for an earlier page
  const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  const emit = (ev, ...args) => { for (const fn of listeners[ev] || []) { try { fn(...args); } catch (e) { console.error(e); } } };

  native.addEventListener('message', e => {
    const raw = String(e.data);
    const kind = raw[0];
    if (kind === 'B') { back(); return; }
    if (kind === 'U') { try { emit('update-progress', JSON.parse(raw.slice(1))); } catch {} return; }
    let m; try { m = JSON.parse(raw.slice(1)); } catch { return; }
    if (kind === 'P') {        // from WellWrite's engine
      if (m.ev) { emit(m.ev, ...(m.args || [])); return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      m.r && m.r.ok ? p.resolve(m.r.value) : p.reject(new Error((m.r && m.r.error) || 'Something went wrong'));
    } else if (kind === 'R') { // from the Android app itself
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id);
      m.ok ? p.resolve(m.value) : p.reject(new Error(m.error || 'Something went wrong'));
    }
  });
  const request = (prefix, body) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    native.postMessage(prefix + ascii(JSON.stringify({ id, ...body })));
  });
  /** Ask WellWrite's engine. */
  const engine = (ch, ...args) => request('E', { ch, args });
  /** Ask the Android app (files, links, the back button). */
  const app = (op, args = {}) => request('N', { op, ...args });
  native.postMessage('H');   // hello: lets the app reply to this page

  // ---------- files ----------
  /** Let the person pick a file; resolves to a File or null. */
  function pickFile(accept) {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept || ''; input.hidden = true;
      let done = false;
      const finish = f => { if (done) return; done = true; input.remove(); resolve(f || null); };
      input.addEventListener('change', () => finish(input.files && input.files[0]));
      input.addEventListener('cancel', () => finish(null));
      // If the chooser closes without choosing, the page gets focus back.
      window.addEventListener('focus', () => setTimeout(() => finish(input.files && input.files[0]), 1200), { once: true });
      document.body.append(input);
      input.click();
    });
  }
  const readText = f => f.text().then(t => t.replace(/^﻿/, ''));
  const readBase64 = f => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Couldn’t read that file'));
    r.readAsDataURL(f);
  });
  const MAX = 25 * 1024 * 1024;
  /** The engine wrote a file for you to keep: Android asks where to save it. */
  async function saved(r) {
    if (!r || !r.save) return r;
    const name = await app('saveFile', r.save);
    if (!name) return null;
    return { ...r.value, file: name };
  }

  // ---------- the app going to the background ----------
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); emit('app:flush'); return; }
    if (!hiddenAt) return;
    const away = Date.now() - hiddenAt; hiddenAt = 0;
    engine('settings:get').then(s => {
      const m = +s.autoLockMinutes || 0;
      if (s.lockOnMinimize || (m > 0 && away > m * 60000)) emit('app:lock');
    }).catch(() => {});
  });

  // ---------- the back button ----------
  // Closes whatever is open on top; otherwise the app goes to the background (like Home).
  function back() {
    const dlg = [...document.querySelectorAll('dialog[open]')].pop();
    // A dialog with its own way back (Settings: from a section to the list) uses that first.
    const own = dlg && [...dlg.querySelectorAll('[data-back]')].find(b => b.checkVisibility());
    if (own) { own.click(); return; }
    if (dlg) { const c = new Event('cancel', { cancelable: true }); dlg.dispatchEvent(c); if (!c.defaultPrevented) dlg.close(); return; }
    for (const sel of ['#popover:not([hidden])', '#lightbox:not([hidden])']) {
      const el = document.querySelector(sel);
      if (el) { el.hidden = true; return; }
    }
    if (document.body.classList.contains('drawer-open')) { document.body.classList.remove('drawer-open'); return; }
    if (emitBack()) return;
    app('background').catch(() => {});
  }
  /** The page can handle the back button itself (e.g. leaving the Bible for the journal). */
  const backHandlers = [];
  const emitBack = () => backHandlers.some(fn => { try { return fn() === true; } catch { return false; } });

  window.wellwrite = {
    platform: 'android',
    onBack: fn => backHandlers.push(fn),
    systemBars: o => app('bars', { color: String(o.color), light: !!o.light }),
    status: () => engine('vault:status'),
    create: pw => engine('vault:create', pw),
    unlock: pw => engine('vault:unlock', pw),
    lock: () => engine('vault:lock'),
    unlockTrusted: () => engine('vault:unlockTrusted'),
    setTrust: mode => engine('vault:setTrust', mode),
    changePassword: (a, b) => engine('vault:changePassword', a, b),
    list: () => engine('entries:list'),
    get: id => engine('entries:get', id),
    save: e => engine('entries:save', e),
    remove: id => engine('entries:remove', id),
    getCategories: () => engine('categories:get'),
    setCategories: list => engine('categories:set', list),
    moveCategory: (fromId, toId) => engine('categories:move', fromId, toId),
    bibleInfo: () => engine('bible:info'),
    setBibleState: st => engine('bible:setState', st),
    bibleReading: (plan, day, translation) => engine('bible:reading', plan, day, translation),
    verseOfDay: (dayNumber, translation) => engine('bible:verseOfDay', dayNumber, translation),
    verses: (refs, translation) => engine('bible:verses', refs, translation),
    bibleBooks: () => engine('bible:books'),
    bibleParseRef: text => engine('bible:parseRef', text),
    bibleChapter: (translation, book, chapter) => engine('bible:chapter', translation, book, chapter),
    bibleSearch: (translation, query, offset) => engine('bible:search', translation, query, offset),
    wpStatus: () => engine('wp:status'),
    wpConnect: (site, user, password) => engine('wp:connect', site, user, password),
    wpForget: () => engine('wp:forget'),
    wpRecord: entryId => engine('wp:record', entryId),
    wpLinks: () => engine('wp:links'),
    wpPublish: (entryId, payload) => engine('wp:publish', entryId, payload),
    wpOpen: url => engine('wp:open', url),
    apiBibleStatus: () => engine('apibible:status'),
    apiBibleSetKey: key => engine('apibible:setKey', key),
    apiBibleForget: () => engine('apibible:forget'),
    apiBibleList: language => engine('apibible:list', language),
    apiBibleSetVersions: list => engine('apibible:setVersions', list),
    getPicture: key => engine('pictures:get', key),
    pictureInfo: key => engine('pictures:info', key),
    fetchDefaultPicture: key => engine('pictures:fetchDefault', key),
    restoreDefaultPicture: key => engine('pictures:restoreDefault', key),
    pictureKeys: () => engine('pictures:keys'),
    setPicture: (key, dataUrl) => engine('pictures:set', key, dataUrl),
    removePicture: key => engine('pictures:remove', key),
    getQuotes: () => engine('quotes:get'),
    builtinReadings: () => engine('readings:builtin'),
    pickReadingsFile: async () => {
      const f = await pickFile('text/plain,text/markdown,.txt,.md');
      if (!f) return null;
      if (f.size > MAX) throw new Error('Your readings file is too large');
      return engine('android:setReadingsText', f.name, await readText(f));
    },
    forgetReadingsFile: () => engine('readings:forgetFile'),
    readReadingsFile: () => engine('readings:readFile'),
    syncReadings: (packId, items, retired) => engine('readings:sync', packId, items, retired),
    onReadingsChanged: fn => on('readings:changed', fn),
    setQuotes: list => engine('quotes:set', list),
    pickQuotesFile: async () => {
      const f = await pickFile('text/plain,text/markdown,text/csv,.txt,.md,.csv');
      if (!f) return null;
      if (f.size > MAX) throw new Error('That file is too large to import');
      return { name: f.name, text: await readText(f) };
    },
    exportQuotes: async text => { const r = await saved(await engine('quotes:export', text)); return r && r.file; },
    getSettings: () => engine('settings:get'),
    setSettings: s => engine('settings:set', s),
    showDataFolder: async () => true,
    exportBackup: async () => saved(await engine('backup:export')),
    pickBackup: async () => {
      const f = await pickFile('');
      if (!f) return null;
      if (f.size > 400 * 1024 * 1024) throw new Error('That file is too large');
      return engine('android:stageFile', f.name, await readBase64(f));
    },
    importBackup: (f, pw) => engine('backup:import', f, pw),
    restoreFresh: (f, pw) => engine('backup:restoreFresh', f, pw),
    exportReadable: async () => saved(await engine('export:readable')),
    openExternal: url => app('openUrl', { url: String(url) }),
    backupInfo: () => engine('backup:info'),
    backupNow: () => engine('backup:now'),
    chooseBackupFolder: suggested => engine('backup:chooseFolder', suggested),
    showBackupFolder: async () => true,
    googleConnect: () => engine('google:connect'),
    googleCancel: () => engine('google:cancel'),
    googleDisconnect: () => engine('google:disconnect'),
    googleList: () => engine('google:list'),
    googleImport: (id, pw) => engine('google:import', id, pw),
    googleRestoreFresh: (id, pw) => engine('google:restoreFresh', id, pw),
    onBackupResult: fn => on('backup:result', fn),
    version: () => engine('app:version'),
    showLog: async () => false,
    checkUpdates: () => engine('app:checkUpdates'),
    // Updates: downloaded by the app (on Wi-Fi, without asking), then Android's own "Update" prompt.
    installUpdate: async () => { const u = await engine('app:installUpdate'); if (u) return app('installUpdate', u); },
    onUpdateProgress: fn => on('update-progress', fn),
    onUpdateReady: fn => on('app:update-ready', fn),
    prefetchUpdate: async () => { const u = await engine('app:installUpdate'); if (u) return app('downloadUpdate', { ...u, auto: true }); },
    onFlush: fn => on('app:flush', fn),
    onLock: fn => on('app:lock', fn),
  };
})();
