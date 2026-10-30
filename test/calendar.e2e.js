'use strict';
// Clicking calendar days switches the page shown on the right.
// Run: xvfb-run -a npx electron --no-sandbox test/calendar.e2e.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-cal-'));
const { app } = require('electron');
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`);
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date(), d2 = new Date(today); d2.setDate(today.getDate() - 2);
  const empty = new Date(today); empty.setDate(today.getDate() - 1);
  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);
  await js(`await window.wellwrite.save({ date: '${iso(d2)}', title: 'Two days ago', html: '<p>earlier</p>', text: 'earlier' }); document.querySelector('#lockBtn').click();`);
  await wait(600);
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`);
  await wait(2500);
  const clickDay = d => js(`[...document.querySelectorAll('.cal-day:not(.out)')].find(b => b.textContent === '${d.getDate()}').click();`);
  const page = () => js(`return { day: document.querySelector('#stampDay').textContent, title: document.querySelector('#title').value, sheet: !document.querySelector('#sheet').hidden, saveState: document.querySelector('#saveState').textContent }`);

  if (d2.getMonth() !== today.getMonth()) { console.log('skipped: month boundary'); app.exit(0); return; }
  await clickDay(d2); await wait(500);
  let p = await page();
  assert.equal(p.day, String(d2.getDate())); assert.equal(p.title, 'Two days ago');

  await clickDay(empty); await wait(500);
  p = await page();
  assert(p.sheet, 'page visible');
  assert.equal(p.day, String(empty.getDate()), 'shows the clicked empty day, not the previous entry');
  const expected = await js(`return dateTitle('${iso(empty)}')`);
  assert.equal(p.title, expected, 'new entry is titled with its date');
  assert.match(expected, new RegExp(String(empty.getDate())));
  const n0 = (await js(`return (await window.wellwrite.list()).length`));
  await clickDay(d2); await wait(500);
  assert.equal((await js(`return (await window.wellwrite.list()).length`)), n0, 'blank page was not saved');

  await clickDay(empty); await wait(400);
  win.webContents.focus();
  await js(`document.querySelector('#body').focus();`);
  await win.webContents.insertText('Wrote this on the empty day.');
  await wait(1500);
  const list = await js(`return (await window.wellwrite.list()).map(m => m.date)`);
  assert(list.includes(iso(empty)), 'typing saves it on the clicked day');
  let saved = await js(`return (await window.wellwrite.list()).find(m => m.date === '${iso(empty)}')`);
  assert.equal(saved.title, expected, 'date title saved');

  // add to the date title: cursor lands at the end
  await js(`document.querySelector('#title').focus();`); await wait(100);
  await win.webContents.insertText(' – beach trip');
  await wait(1500);
  saved = await js(`return (await window.wellwrite.list()).find(m => m.date === '${iso(empty)}')`);
  assert.equal(saved.title, expected + ' – beach trip', 'appended to the date');

  // a new entry: change its date and the default title follows
  await js(`document.querySelector('#newBtn').click();`); await wait(400);
  await js(`const d = document.querySelector('#dateInput'); d.value = '${iso(d2)}'; d.dispatchEvent(new Event('change'));`); await wait(200);
  assert.equal(await js(`return document.querySelector('#title').value`), await js(`return dateTitle('${iso(d2)}')`), 'default title follows the date');
  // a custom title is left alone when the date changes
  await js(`const t = document.querySelector('#title'); t.value = 'My own title'; t.dispatchEvent(new Event('input'));`);
  await js(`const d = document.querySelector('#dateInput'); d.value = '${iso(today)}'; d.dispatchEvent(new Event('change'));`); await wait(1500);
  assert.equal(await js(`return document.querySelector('#title').value`), 'My own title');
  saved = await js(`return (await window.wellwrite.list()).find(m => m.title === 'My own title')`);
  assert(saved && saved.date === iso(today), 'custom title saved with its date');

  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(os.tmpdir(), 'wellwrite-calendar.png'), img.toPNG());
  console.log('calendar e2e passed');
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
