'use strict';
// Remember my password: one hour, trust this computer, back to asking.
// Run: xvfb-run -a npx electron --no-sandbox test/trust.e2e.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-trust-e2e-'));
process.env.WELLWRITE_TEST_TRUST = '1';
const OUT = path.join(os.tmpdir(), 'wellwrite-trust-shots'); fs.mkdirSync(OUT, { recursive: true });
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 820);
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 140)); });
  const shot = async n => { await wait(300); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const visible = sel => js(`return !document.querySelector('${sel}').hidden`);

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);

  // choose "for an hour" in settings
  await js(`openSettings();`); await wait(400);
  await js(`const s = [...document.querySelectorAll('#dlg select')].find(x => x.getAttribute('aria-label') === 'Remember my password'); s.value = 'hour'; s.dispatchEvent(new Event('change'));`);
  await wait(500);
  let st = await js(`return (await window.wellwrite.status()).trust`);
  assert.equal(st.mode, 'hour'); assert(st.active);
  await shot('t1-settings');
  await js(`document.querySelector('#dlg').close();`);

  // lock -> one click to open
  await js(`document.querySelector('#lockBtn').click();`); await wait(700);
  assert(await visible('#trustForm'), 'one-click open shown');
  assert(!(await visible('#unlockForm')), 'no password box');
  assert.match(await js(`return document.querySelector('#trustText').textContent`), /No password needed until/);
  await shot('t2-lock-remembered');
  await js(`document.querySelector('#trustOpen').click();`); await wait(1500);
  assert(await js(`return state.unlocked`), 'opened without password');

  // restart the window: opens straight in
  await js(`await window.wellwrite.lock();`);
  win.webContents.reload(); await new Promise(r => win.webContents.once('did-finish-load', r)); await wait(2500);
  assert(await js(`return state.unlocked && document.querySelector('#lock').hidden`), 'reopens straight into the journal');

  // "use my password instead" still works
  await js(`document.querySelector('#lockBtn').click();`); await wait(700);
  await js(`document.querySelector('#trustUsePw').click();`); await wait(200);
  assert(await visible('#unlockForm'));
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`); await wait(2500);
  assert(await js(`return state.unlocked`));

  // trust this computer (with confirmation)
  await js(`openSettings();`); await wait(400);
  await js(`const s = [...document.querySelectorAll('#dlg select')].find(x => x.getAttribute('aria-label') === 'Remember my password'); s.value = 'trust'; s.dispatchEvent(new Event('change'));`);
  await wait(400);
  assert.match(await js(`return document.querySelector('#dlg h2').textContent`), /Trust this computer/);
  await shot('t3-trust-confirm');
  await js(`[...document.querySelectorAll('#dlg button')].find(b => b.textContent === 'Trust this computer').click();`); await wait(800);
  st = await js(`return (await window.wellwrite.status()).trust`);
  assert.equal(st.mode, 'trust'); assert.equal(st.until, null);
  await js(`document.querySelector('#dlg').close(); document.querySelector('#lockBtn').click();`); await wait(700);
  assert.match(await js(`return document.querySelector('#trustText').textContent`), /trusted/);
  await js(`document.querySelector('#trustOpen').click();`); await wait(1500);

  // back to asking every time
  await js(`openSettings();`); await wait(400);
  await js(`const s = [...document.querySelectorAll('#dlg select')].find(x => x.getAttribute('aria-label') === 'Remember my password'); s.value = 'ask'; s.dispatchEvent(new Event('change'));`);
  await wait(500);
  await js(`document.querySelector('#dlg').close(); document.querySelector('#lockBtn').click();`); await wait(700);
  assert(await visible('#unlockForm') && !(await visible('#trustForm')), 'asks for the password again');
  assert(!fs.existsSync(path.join(process.env.WELLWRITE_DATA_DIR, 'trusted.json')), 'saved key removed');

  console.log('trust e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
