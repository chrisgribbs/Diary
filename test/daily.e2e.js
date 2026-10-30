'use strict';
// Daily quote, quotes library and imports, Bible reading plan, Journal/Bible/Quote views.
// Run: xvfb-run -a npx electron --no-sandbox test/daily.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-daily-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-daily-shots'));
fs.mkdirSync(OUT, { recursive: true });
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-'))); // fresh browser storage each run
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 860);
  win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 160)); });
  const shot = async n => { await wait(350); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const text = sel => js(`const n = document.querySelector('${sel}'); return n ? n.innerText : null`);

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);

  // --- starter quotes and the card on the opening screen
  const quotes = await js(`return state.quotes.length`);
  assert(quotes >= 15, 'starter quotes loaded');
  assert(await js(`return !!document.querySelector('#empty .quote-card')`), 'quote on the opening screen');
  await shot('d1-empty-with-quote');

  // --- Bible: choose a plan
  await js(`document.querySelector('.modeswitch [data-mode=bible]').click();`); await wait(600);
  assert.match(await text('#bibleView'), /Read through the Bible/);
  assert(await js(`return !!document.querySelector('#bibleView .quote-card.verse')`), 'verse of the day on the plan chooser');
  await shot('d2-bible-choose');
  await js(`document.querySelector('#bibleView input[value=gospels30]').click(); [...document.querySelectorAll('#bibleView button')].find(b => b.textContent === 'Start reading plan').click();`);
  await wait(900);
  assert.match(await text('#bibleView .rv-title'), /Day 1\s*of 30/);
  assert.match(await text('#bibleView .rv-ref'), /Matthew 1–2/);
  assert.match(await text('#bibleView .passage'), /The book of the genealogy of Jesus Christ/);
  await shot('d3-bible-day1');
  await js(`[...document.querySelectorAll('#bibleView .rv-actions button')].find(b => b.textContent === 'Mark as read').click();`); await wait(700);
  assert.match(await text('#bibleView .rv-status'), /1 of 30 days read/);
  assert.deepEqual(await js(`return (await window.wellwrite.bibleInfo()).state.done`), [0]);
  await js(`document.querySelector('#bibleView .rv-nav [aria-label="Next day"]').click();`); await wait(600);
  assert.match(await text('#bibleView .rv-title'), /Day 2/);
  await js(`[...document.querySelectorAll('#bibleView .rv-nav button')].find(b => b.textContent === 'Today').click();`); await wait(600);
  assert.match(await text('#bibleView .rv-title'), /Day 1/);

  // KJV via plan settings keeps progress
  await js(`[...document.querySelectorAll('#bibleView button')].find(b => b.textContent === 'Plan settings').click();`); await wait(300);
  await js(`const s = [...document.querySelectorAll('#dlg select')][1]; s.value = 'kjv'; document.querySelector('#dlgForm').requestSubmit();`); await wait(900);
  assert.match(await text('#bibleView .passage'), /The book of the generation of Jesus Christ/);
  assert.match(await text('#bibleView .rv-status'), /1 of 30 days read/, 'progress kept when changing translation');

  // write about the reading -> journal
  await js(`[...document.querySelectorAll('#bibleView button')].find(b => b.textContent === 'Write about this reading').click();`); await wait(1500);
  assert.equal(await js(`return state.mode`), 'journal');
  assert.match(await text('#body'), /Today’s reading: Matthew 1–2 \(KJV\)/);

  // --- above journal: both / none
  await js(`document.querySelector('#showAbove').click();`); await wait(200);
  await js(`[...document.querySelectorAll('#popover .menu-item')].find(b => b.textContent === 'Quote and verse').click();`); await wait(800);
  assert.equal(await js(`return document.querySelectorAll('#quoteSlot .quote-card').length`), 2, 'quote and verse above the journal');
  await shot('d4-journal-both');
  await js(`document.querySelector('#showAbove').click();`); await wait(200);
  await js(`[...document.querySelectorAll('#popover .menu-item')].find(b => b.textContent.startsWith('Nothing')).click();`); await wait(500);
  assert(await js(`return document.querySelector('#quoteSlot').hidden`), 'nothing above the journal');
  await js(`document.querySelector('#showAbove').click();`); await wait(200);
  await js(`[...document.querySelectorAll('#popover .menu-item')].find(b => b.textContent === 'Verse of the day').click();`); await wait(800);
  assert.equal(await js(`return document.querySelectorAll('#quoteSlot .quote-card.verse').length`), 1);

  // --- quote view
  await js(`document.querySelector('.modeswitch [data-mode=quote]').click();`); await wait(500);
  const q1 = await text('#quoteView .big-quote blockquote');
  assert(q1 && q1.length > 5);
  await shot('d5-quote-view');
  await js(`[...document.querySelectorAll('#quoteView button')].find(b => b.textContent === 'Another').click();`); await wait(300);
  const q2 = await text('#quoteView .big-quote blockquote');
  assert.notEqual(q1, q2, 'Another shows a different quote');
  await js(`[...document.querySelectorAll('#quoteView button')].find(b => b.textContent === 'Write about this').click();`); await wait(1200);
  assert.equal(await js(`return state.mode`), 'journal');
  assert((await text('#body')).includes(q2.split('\n')[0]), 'quote written into today’s entry');

  // --- quotes library: add, paste several, Kindle import
  await js(`manageQuotes();`); await wait(300);
  await js(`const t = document.querySelector('#dlg textarea'); t.value = 'My own line about mornings.'; const [a, b] = document.querySelectorAll('#dlg .q-two input'); a.value = 'Me'; b.value = 'Notebook'; [...document.querySelectorAll('#dlg button')].find(x => x.textContent === 'Add quote').click();`);
  await wait(700);
  assert(await js(`return state.quotes.some(q => q.text === 'My own line about mornings.' && q.author === 'Me')`));
  await shot('d6-quotes-dialog');

  const pasted = await js(`return parsePastedQuotes(${JSON.stringify('First line of one.\nSecond line.\n— Ann Writer, Some Book\n\n"A one-liner." — Bob Poet\n\nNo attribution here.')}, 'Default Name', 'Default Book')`);
  assert.deepEqual(pasted, [
    { text: 'First line of one.\nSecond line.', author: 'Ann Writer', source: 'Some Book' },
    { text: 'A one-liner.', author: 'Bob Poet', source: '' },
    { text: 'No attribution here.', author: 'Default Name', source: 'Default Book' },
  ]);
  const kindle = [
    'Anam Cara (O\'Donohue, John)', '- Your Highlight on page 12 | location 180-182 | Added on Monday, 3 March 2025 7:10:00 AM', '', 'A short highlight.', '==========',
    'Anam Cara (O\'Donohue, John)', '- Your Highlight on page 12 | location 180-185 | Added on Monday, 3 March 2025 7:11:00 AM', '', 'A short highlight. Made longer later.', '==========',
    'Anam Cara (O\'Donohue, John)', '- Your Note on page 12 | location 185 | Added on Monday, 3 March 2025 7:12:00 AM', '', 'my own note, not a quote', '==========',
    'Let Your Life Speak (Parker J. Palmer)', '- Your Highlight on page 3 | Added on Tuesday, 4 March 2025 8:00:00 PM', '', 'Another highlighted passage.', '==========',
    'Some Book (Someone)', '- Your Bookmark on page 9 | Added on Tuesday, 4 March 2025 8:00:00 PM', '', '', '==========', ''].join('\r\n');
  const found = await js(`return parseKindle(${JSON.stringify(kindle)})`);
  assert.deepEqual(found, [
    { text: 'A short highlight. Made longer later.', author: "John O'Donohue", source: 'Anam Cara' },
    { text: 'Another highlighted passage.', author: 'Parker J. Palmer', source: 'Let Your Life Speak' },
  ], 'Kindle: highlights only, longer version kept, author turned round');
  await js(`importPreview(parseKindle(${JSON.stringify(kindle)}), 'Kindle highlights');`); await wait(300);
  await shot('d7-kindle-import');
  await js(`document.querySelector('#dlgForm').requestSubmit();`); await wait(900);
  assert(await js(`return state.quotes.some(q => q.author === "John O'Donohue" && q.source === 'Anam Cara')`));
  await js(`document.querySelector('#dlg').close();`);

  // only one writer's quotes
  await updateFrom(js, "author:John O'Donohue");
  await js(`document.querySelector('.modeswitch [data-mode=quote]').click();`); await wait(400);
  assert.match(await text('#quoteView .big-quote figcaption'), /John O’Donohue|John O'Donohue/);

  // --- lock / unlock keeps everything
  await js(`document.querySelector('#lockBtn').click();`); await wait(700);
  assert.equal(await js(`return document.querySelector('#bibleView').innerText + document.querySelector('#quoteView').innerText`), '', 'views cleared on lock');
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`); await wait(2500);
  assert.equal(await js(`return state.mode`), 'quote', 'view remembered');
  await js(`document.querySelector('.modeswitch [data-mode=bible]').click();`); await wait(700);
  assert.match(await text('#bibleView .rv-status'), /1 of 30 days read/);

  assert.deepEqual(errors, [], 'no console errors');
  console.log('daily e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });

async function updateFrom(js, v) { await js(`await updateSetting({ quoteFrom: ${JSON.stringify(v)} })`); }
