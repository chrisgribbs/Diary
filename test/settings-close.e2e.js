'use strict';
// Settings always closes with Done or Esc (on every tab), and page errors go to the problems log.
// Run: xvfb-run -a npx electron --no-sandbox test/settings-close.e2e.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-set-'));
const { app } = require('electron');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-'));
app.setPath('userData', profile);
const wait = ms => new Promise(r => setTimeout(r, ms));
const { getWindow } = require('../main.js');

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1400, 900);
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`);
  const open = () => js(`return document.querySelector('#dlg').open`);
  const click = async sel => {
    const [x, y] = await js(`const r = document.querySelector('${sel}').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]`);
    for (const type of ['mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    await wait(500);
  };
  const esc = async () => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait(500); };

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);

  const tabs = await js(`return SETTINGS_TABS.map(([k]) => k)`);
  for (const t of tabs) {
    await js(`openSettings('${t}')`); await wait(600);
    assert.ok(await open(), `${t}: Settings opens`);
    await click('.set-done');
    assert.ok(!(await open()), `${t}: Done closes Settings`);
    await js(`openSettings('${t}')`); await wait(600);
    await js(`const s = document.querySelector('#dlg select'); if (s) s.focus();`);   // even with a list box focused
    await esc();
    assert.ok(!(await open()), `${t}: Esc closes Settings`);
  }
  // Done still closes if closing the dialog the usual way fails
  await js(`openSettings('bible')`); await wait(600);
  await js(`const d = document.querySelector('#dlg'); d.close = () => { throw new Error('test: close failed'); };`);
  await click('.set-done');
  assert.ok(!(await open()), 'Done closes even when close() fails');
  await js(`delete document.querySelector('#dlg').close`);

  // the problems log
  await js(`console.error('test: something went wrong')`); await wait(300);
  const log = fs.readFileSync(path.join(profile, 'logs', 'wellwrite.log'), 'utf8');
  assert.match(log, /error: test: something went wrong/);
  await js(`openSettings('about')`); await wait(600);
  assert.ok(await js(`return [...document.querySelectorAll('#dlg button')].some(b => b.textContent === 'Show log')`), 'Show log in About');

  console.log('settings close e2e passed');
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
