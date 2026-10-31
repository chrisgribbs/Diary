'use strict';
// Reading packs: built-in writing loads by itself; a readings file is chosen once and kept in step.
// Run: xvfb-run -a npx electron --no-sandbox test/readings.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-readings-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-readings-shots'));
fs.mkdirSync(OUT, { recursive: true });
const { app, dialog } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-rfile-')), 'My readings.txt');
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [FILE] });   // stands in for the file picker
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const built = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/readings/wellwrite.json'), 'utf8'));

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 900);
  win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 160)); });
  const shot = async n => { await wait(400); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const count = id => js(`return state.quotes.filter(q => q.pack === '${id}').length`);

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(3000);

  // built in: there from the start, no importing
  assert.equal(await count('wellwrite'), built.items.length, 'built-in writing loaded on first unlock');
  await js(`document.querySelector('.modeswitch [data-mode=quote]').click();`); await wait(900);
  assert.match(await js(`return document.querySelector('#quoteView .wk-reflection .wk-sign').innerText`), /Chris Gribble/);
  await js(`document.querySelector('#quoteView .wk-reflection').scrollIntoView()`); await shot('r1-reflection');

  // choose a readings file once
  const q = (t, a, th) => `${t}\n— ${a}\nThemes: ${th}`;
  fs.writeFileSync(FILE, '﻿' + [q('One quote.', 'Ann Writer', 'Hope & renewal'), q('Two quote.', 'Bob Poet', 'Prayer'), q('Three quote.', 'Cy Sage', 'Joy')].join('\r\n\r\n\r\n'));
  await js(`manageQuotes();`); await wait(400);
  await shot('r2-readings-controls');
  await js(`document.querySelector('#pickReadings').click();`); await wait(1200);
  assert.equal(await count('file'), 3);
  assert.match(await js(`return document.querySelector('.readings-box').innerText`), /My readings\.txt: 3 readings, kept up to date/);
  await shot('r3-file-chosen');
  // star one, then change the file outside the app: one changed, one removed, one added
  await js(`await saveQuotes(state.quotes.map(x => x.text === 'One quote.' ? { ...x, fav: true } : x));`);
  fs.writeFileSync(FILE, [q('One quote.', 'Ann Writer', 'Hope & renewal, Joy'), q('Three quote.', 'Cy Sage', 'Joy'), q('Four quote.', 'Di Bard', 'Soul')].join('\n\n\n'));
  let seen = false;
  for (let i = 0; i < 30 && !seen; i++) { await wait(500); seen = await js(`return state.quotes.some(x => x.text === 'Four quote.')`); }
  assert.ok(seen, 'file change picked up while the app is open');
  assert.equal(await count('file'), 3);
  assert.ok(!(await js(`return state.quotes.some(x => x.text === 'Two quote.')`)), 'removed from the file → removed');
  assert.deepEqual(await js(`return state.quotes.find(x => x.text === 'One quote.').themes`), ['Hope & renewal', 'Joy']);
  assert.equal(await js(`return state.quotes.find(x => x.text === 'One quote.').fav`), true, 'star kept');
  await shot('r4-after-file-change');

  // lock and unlock: nothing doubles up
  const total = await js(`return state.quotes.length`);
  await js(`document.querySelector('#dlg').open && document.querySelector('#dlg').close(); document.querySelector('#lockBtn').click();`); await wait(700);
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`); await wait(2500);
  assert.equal(await js(`return state.quotes.length`), total, 'same collection after unlocking');

  // built-in off and on again
  await js(`manageQuotes();`); await wait(400);
  await js(`document.querySelector('#builtinReadings').click();`); await wait(1200);
  assert.equal(await count('wellwrite'), 0);
  await js(`document.querySelector('#builtinReadings').click();`); await wait(1200);
  assert.equal(await count('wellwrite'), built.items.length);

  // stop using the file
  await js(`[...document.querySelectorAll('.readings-box button')].find(b => b.textContent === 'Stop using').click();`); await wait(1000);
  assert.equal(await count('file'), 0);
  assert.match(await js(`return document.querySelector('.readings-box').innerText`), /Choose a text file/);

  assert.deepEqual(errors, [], 'no console errors');
  console.log('readings e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
