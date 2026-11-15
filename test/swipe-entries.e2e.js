'use strict';
// Swiping between journal entries (phones): right for the one before, left for the next, past the newest to today.
// Run: xvfb-run -a npx electron --no-sandbox test/swipe-entries.e2e.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-swipe-e2e-'));
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 140)); });
  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);
  // Three days of entries (two on the middle day), none today.
  const ids = await js(`
    const mk = async (date, time, words) => (await api.save({ id: crypto.randomUUID(), date, time, title: words, html: '<p>' + words + '</p>', text: words, tags: [] })).id;
    const a = await mk('2026-11-01', '08:00', 'First');
    const b = await mk('2026-11-05', '07:00', 'Second morning');
    const c = await mk('2026-11-05', '21:00', 'Second evening');
    const d = await mk('2026-11-09', '09:00', 'Third');
    state.metas = await api.list(); renderSidebar();
    return [a, b, c, d];`);
  const title = () => js(`return document.querySelector('#title').value`);
  await js(`await openEntry('${ids[1]}');`); await wait(300);
  assert.equal(await title(), 'Second morning');
  await js(`await swipeTo(-1);`); await wait(300);
  assert.equal(await title(), 'First', 'swipe right: the entry before');
  await js(`await swipeTo(-1);`); await wait(300);
  assert.equal(await title(), 'First', 'nothing before the first: stays');
  assert(await js(`return document.querySelector('#sheet').classList.contains('nudge')`), 'with a nudge');
  await js(`await swipeTo(1);`); await wait(300);
  assert.equal(await title(), 'Second morning', 'swipe left: the next');
  await js(`await swipeTo(1);`); await wait(300);
  assert.equal(await title(), 'Second evening', 'the same day, later');
  await js(`await swipeTo(1);`); await wait(300);
  assert.equal(await title(), 'Third');
  await js(`await swipeTo(1);`); await wait(500);
  assert.equal(await js(`return state.current.date`), await js(`return todayISO()`), 'past the newest: today');
  await js(`await swipeTo(-1);`); await wait(300);
  assert.equal(await title(), 'Third', 'and back from today');
  console.log('swipe entries e2e passed');
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
