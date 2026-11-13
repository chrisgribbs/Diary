'use strict';
// The prayer bell on Windows: turning it on in Settings, a bell's notification and sound, Pause for prayer,
// Write a line, Mute today, and closing the window keeping WellWrite in the tray.
// Run: xvfb-run -a npx electron --no-sandbox test/prayer.e2e.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-prayer-e2e-'));
process.env.WELLWRITE_TEST_PRAYER = '1';
const OUT = path.join(os.tmpdir(), 'wellwrite-prayer-shots'); fs.mkdirSync(OUT, { recursive: true });
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 860);
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 140)); });
  const shot = async n => { await wait(300); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);

  // Off at first; the bell button is hidden.
  assert.equal(await js(`return state.settings.prayerBell`), false);
  assert(await js(`return document.querySelector('#bellBtn').hidden`));
  await js(`openSettings('prayer');`); await wait(700);
  await shot('p1-off');
  assert(!/null/.test(await js(`return document.querySelector('#set-prayer').textContent`)), 'no stray "null" on the page');
  await js(`document.querySelector('#set-prayer .row input[type=checkbox]').click();`); await wait(900);
  assert.equal(await js(`return state.settings.prayerBell`), true, 'turned on');
  assert.equal(await js(`return document.querySelectorAll('#set-prayer .ph-row').length`), 5, 'five hours listed');
  await shot('p2-on');
  // Change midday to 12:30.
  await js(`const t = [...document.querySelectorAll('#set-prayer .ph-row input[type=time]')][1]; t.value = '12:30'; t.dispatchEvent(new Event('change'));`); await wait(700);
  assert.equal(await js(`return state.settings.prayerTimes.midday`), '12:30');
  assert(await js(`return (await window.wellwrite.prayerUpcoming(2)).some(b => b.key === 'midday' && new Date(b.at).getMinutes() === 30)`));
  assert(!(await js(`return document.querySelector('#bellBtn').hidden`)), 'bell button shows');

  // A bell: a silent notification, and the page plays the bell.
  await js(`window.__rang = 0; const A = window.Audio; window.Audio = function (src) { const a = new A(src); a.play = () => { window.__rang++; window.__src = src; return Promise.resolve(); }; return a; };`);
  await js(`await window.wellwrite.prayerTest();`); await wait(500);
  const rang = await win.webContents.executeJavaScript(`window.__rang`);
  assert.equal(rang, 1, 'the bell sounds');
  assert.equal(await win.webContents.executeJavaScript(`window.__src`), 'sounds/bell.ogg');
  const notes = await js(`return await window.wellwrite.prayerTestLog()`);
  assert.ok(notes.length === 1 && /prayer$/.test(notes[0].title) && notes[0].body.length > 20, 'a notification with the hour and a verse: ' + JSON.stringify(notes));
  await js(`document.querySelector('#dlg').close();`);

  // Pause for prayer: verse, prayer, buttons.
  await js(`pauseForPrayer('evening');`); await wait(800);
  assert.match(await js(`return document.querySelector('.pp-hour').textContent`), /Evening prayer/);
  assert(await js(`return document.querySelector('.pp-verse cite').textContent.length > 3 && document.querySelector('.pp-prayer p').textContent.length > 40`));
  await shot('p3-pause');
  // Write a line → today's entry gets "Evening prayer".
  await js(`[...document.querySelectorAll('#dlg .actions button')].find(b => b.textContent === 'Write a line').click();`); await wait(1200);
  assert.match(await js(`return document.querySelector('#body').innerHTML`), /Evening prayer/);
  await shot('p4-line');

  // Mute today from the bell menu.
  await js(`document.querySelector('#bellBtn').click();`); await wait(300);
  await js(`[...document.querySelectorAll('#popover .menu-item')].find(b => /Mute the bell today/.test(b.textContent)).click();`); await wait(700);
  assert(await js(`return mutedToday()`), 'muted today');
  assert(await js(`return (await window.wellwrite.prayerUpcoming(1)).every(b => b.date !== todayISO())`), 'no bells left today');
  assert(await js(`return document.querySelector('#bellBtn').classList.contains('muted')`));

  // Closing the window keeps WellWrite running (in the tray), locked.
  win.close(); await wait(3500);
  assert(!win.isDestroyed() && !win.isVisible(), 'window hidden, app still running');
  assert(await js(`return !state.unlocked`), 'journal locked');
  win.show(); await wait(500);

  // Turning the bell off: closing quits as before.
  await js(`await window.wellwrite.setSettings({ ...state.settings, prayerBell: false });`); await wait(300);
  console.log('prayer e2e passed');
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
