'use strict';
// The Bible reader: read a chapter, move between chapters, pick a book, tap verses, search words and references.
// Run: xvfb-run -a npx electron --no-sandbox test/bible.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-bible-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-bible-shots'));
fs.mkdirSync(OUT, { recursive: true });
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 900);
  win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 160)); });
  const shot = async n => { await wait(400); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const text = sel => js(`const n = document.querySelector('${sel}'); return n ? n.innerText : null`);
  const until = async (cond, ms = 5000) => { for (let t = 0; t < ms; t += 150) { if (await js(`return !!(${cond})`)) return true; await wait(150); } return false; };

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);

  // opens on Read, at Psalm 23 the first time
  await js(`document.querySelector('.modeswitch [data-mode=bible]').click();`);
  assert.ok(await until(`document.querySelector('.rd-title')`), 'reader shown');
  assert.equal(await text('.rd-title'), 'Psalm 23');
  assert.match(await text('.rd-text'), /Yahweh is my shepherd/);
  await shot('b1-psalm-23');

  // next / previous chapter
  await js(`[...document.querySelectorAll('.rd-arrow')][1].click();`); assert.ok(await until(`document.querySelector('.rd-title').textContent === 'Psalm 24'`));
  await js(`[...document.querySelectorAll('.rd-arrow')][0].click();`); assert.ok(await until(`document.querySelector('.rd-title').textContent === 'Psalm 23'`));

  // pick a book and chapter
  await js(`document.querySelector('#rdRef').click();`); await wait(300);
  await js(`const f = document.querySelector('#bpFind'); f.value = 'john'; f.dispatchEvent(new Event('input'));`); await wait(150);
  assert.ok(await js(`return [...document.querySelectorAll('.bp-book')].some(b => b.textContent === '1 John')`), 'finds books by name');
  await shot('b2-book-picker');
  await js(`[...document.querySelectorAll('.bp-book')].find(b => b.textContent === 'John').click();`); await wait(150);
  assert.equal(await js(`return document.querySelectorAll('.bp-ch').length`), 21, 'John has 21 chapters');
  await js(`[...document.querySelectorAll('.bp-ch')].find(b => b.textContent === '15').click();`);
  assert.ok(await until(`document.querySelector('.rd-title').textContent === 'John 15'`), 'went to John 15');

  // tap verses: the bar shows the reference; Write about this puts them in today's entry
  await js(`document.querySelector('.rd-v[data-v="4"]').click(); document.querySelector('.rd-v[data-v="5"]').click();`); await wait(150);
  assert.equal(await text('.rd-selbar b'), 'John 15:4–5');
  await shot('b3-verses-selected');
  await js(`[...document.querySelectorAll('.rd-selbar button')].find(b => b.textContent === 'Write about this').click();`); await wait(1200);
  assert.equal(await js(`return state.mode`), 'journal');
  assert.match(await text('#body'), /John 15:4–5/);
  assert.match(await text('#body'), /Remain in me/);

  // remembers where you were
  await js(`state.bibleTab = 'read'; setMode('bible');`); assert.ok(await until(`document.querySelector('.rd-title') && document.querySelector('.rd-title').textContent === 'John 15'`), 'remembers the chapter');

  // search words
  await js(`document.querySelector('.bv-tab[data-tab=search]').click();`); await wait(300);
  await js(`const f = document.querySelector('#bsFind'); f.value = 'be still'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));`);
  assert.ok(await until(`document.querySelectorAll('.bs-item').length > 5`), 'results');
  assert.match(await text('.bs-count'), /verses in the WEB/);
  assert.ok(await js(`return [...document.querySelectorAll('.bs-item b')].some(b => b.textContent === 'Psalm 46:10')`), 'Psalm 46:10 found');
  assert.ok(await js(`return document.querySelectorAll('.bs-item mark').length > 0`), 'words highlighted');
  await shot('b4-search');
  await js(`[...document.querySelectorAll('.bs-item')].find(b => b.querySelector('b').textContent === 'Psalm 46:10').click();`);
  assert.ok(await until(`document.querySelector('.rd-title') && document.querySelector('.rd-title').textContent === 'Psalm 46'`), 'opens the result');
  assert.ok(await js(`return document.querySelector('.rd-v[data-v="10"]').classList.contains('sel')`), 'the verse is marked');

  // a reference goes straight there
  await js(`document.querySelector('.bv-tab[data-tab=search]').click();`); await wait(200);
  await js(`const f = document.querySelector('#bsFind'); f.value = 'rom 8:28'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));`);
  assert.ok(await until(`document.querySelector('.bs-goto')`), 'Go to reference');
  assert.match(await text('.bs-goto'), /Romans 8:28/);
  await js(`document.querySelector('.bs-goto').click();`);
  assert.ok(await until(`document.querySelector('.rd-title') && document.querySelector('.rd-title').textContent === 'Romans 8'`));

  // a phrase in quotes, and Show more
  await js(`document.querySelector('.bv-tab[data-tab=search]').click();`); await wait(200);
  await js(`const f = document.querySelector('#bsFind'); f.value = 'love'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));`);
  assert.ok(await until(`document.querySelector('.bs-more')`), 'Show more for long results');
  const n1 = await js(`return document.querySelectorAll('.bs-item').length`);
  await js(`document.querySelector('.bs-more').click();`); await wait(500);
  assert.ok(await js(`return document.querySelectorAll('.bs-item').length`) > n1, 'more results');

  // in the KJV too
  await js(`await saveBible({ translation: 'kjv' }); state.bibleTab = 'read'; renderBibleView();`);
  assert.ok(await until(`document.querySelector('.rd-text') && /KJV/.test(document.querySelector('.rd-bar').innerText)`), 'KJV reader');
  await shot('b5-kjv');

  // the plans are still one tab away
  await js(`document.querySelector('.bv-tab[data-tab=plan]').click();`); await wait(500);
  assert.match(await text('#bibleView'), /Read through the Bible/);

  assert.deepEqual(errors, [], 'no console errors');
  console.log('bible e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
