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
  const q1 = await text('#quoteView .wk-today blockquote');
  assert(q1 && q1.length > 5);
  await shot('d5-quote-view');
  await js(`[...document.querySelectorAll('#quoteView button')].find(b => b.textContent === 'Another quote').click();`); await wait(500);
  const q2 = await text('#quoteView .wk-today blockquote');
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
    { text: 'First line of one.\nSecond line.', author: 'Ann Writer', source: 'Some Book', themes: [] },
    { text: 'A one-liner.', author: 'Bob Poet', source: '', themes: [] },
    { text: 'No attribution here.', author: 'Default Name', source: 'Default Book', themes: [] },
  ]);

  // A Goodreads page copied from the browser (both of its layouts), poems with stanzas, dashes inside sentences, themes
  const goodreads = [
    'Ann Writer > Quotes', ' ', '(?)', 'Showing 1-30 of 99',
    '“First stanza line,', 'second line.', '', 'Second stanza — with a dash inside — and more.”',
    '― Ann B. Writer, Long Book: A Subtitle That Goes On and On and On', 'tags: life, love12 likes', 'Like',
    '“Short one.”', '― Ann Writer', '7 likes', 'Like',
    '', 'A newer-layout quote,', 'over two lines.', '— Ann Writer', ',', 'Another Book: With Subtitle', '45 likes', '', '',
    'Mine, with themes.', '— Me, Notebook', 'Themes: Hope, true self', '',
  ].join('\n');
  const gr = await js(`return parsePastedQuotes(${JSON.stringify(goodreads)})`);
  assert.deepEqual(gr, [
    { text: 'First stanza line,\nsecond line.\n\nSecond stanza — with a dash inside — and more.', author: 'Ann B. Writer', source: 'Long Book', themes: [] },
    { text: 'Short one.', author: 'Ann B. Writer', source: '', themes: [] },
    { text: 'A newer-layout quote,\nover two lines.', author: 'Ann B. Writer', source: 'Another Book: With Subtitle', themes: [] },
    { text: 'Mine, with themes.', author: 'Me', source: 'Notebook', themes: ['Hope', 'true self'] },
  ], 'Goodreads paste: clutter skipped, stanzas kept, long subtitle trimmed, one name per writer');
  // cut-short quotes go back to a full sentence; edition labels dropped
  const cut = await js(`return parsePastedQuotes(${JSON.stringify('A first full sentence here. A second one that is long enough to matter. Then it stops mid wo...\n— Ann Writer\n,\nGood Book - Revised edition: The Long Subtitle of the Good Book Goes Here\n9 likes')})`);
  assert.equal(cut[0].text, 'A first full sentence here. A second one that is long enough to matter. …');
  assert.equal(cut[0].source, 'Good Book');
  assert.equal(await js(`return trimCutShort('Short line\\nanother line\\nand a broken wo...')`), 'Short line\nanother line …');
  assert.equal(await js(`return trimCutShort('A whole quote that ends properly.')`), 'A whole quote that ends properly.');

  // Goodreads copied as Markdown: links, bullets, series labels, several spellings of one name
  const md = ['* Some saying here.', '[— St. Ann Writer](https://example.org/a)', '[8,519 likes](https://example.org/q)',
    '* Another saying, with a comma.', '[— Ann Writer of Somewhere](https://example.org/a),[Big Book (The Series, #21)](https://example.org/b)', '[2,216 likes](https://example.org/q2)'].join('\n');
  const mdq = await js(`return parsePastedQuotes(${JSON.stringify(md)})`);
  assert.deepEqual(mdq.map(q => [q.text, q.author, q.source]), [['Some saying here.', 'Ann Writer of Somewhere', ''], ['Another saying, with a comma.', 'Ann Writer of Somewhere', 'Big Book']]);

  // export and import again: identical
  const round = await js(`return parsePastedQuotes(quotesAsText(${JSON.stringify(gr)}))`);
  assert.deepEqual(round, gr, 'export → import round trip');

  // theme suggestions learn from themed quotes
  await js(`await saveQuotes([...state.quotes,
    { text: 'Listen for your calling and the work your life is asking of you.', author: 'T', themes: ['Vocation'] },
    { text: 'Your vocation is where your deep gladness meets the work in front of you.', author: 'T', themes: ['Vocation'] },
    { text: 'Grief and loss come like winter; the dark teaches patience.', author: 'T', themes: ['Darkness'] },
    { text: 'In the long dark of grief we learn to wait.', author: 'T', themes: ['Darkness'] }]);`);
  assert.equal((await js(`return suggestThemes('What work is my life calling me toward?')`))[0], 'Vocation');
  assert.equal((await js(`return suggestThemes('The winter of grief was long and dark.')`))[0], 'Darkness');
  assert.deepEqual(await js(`return suggestThemes('Bananas are yellow.')`), []);
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

  // --- the year of themes (on by default: the Christian year)
  await js(`document.querySelector('.modeswitch [data-mode=quote]').click();`); await wait(400);
  const today = await js(`return todayISO()`);
  const season = await js(`return seasonOn(todayISO())`);
  assert.ok(season && season.name, 'a season today');
  assert.match(await text('#quoteView .wk-running'), new RegExp(season.name));
  assert.ok((await text('#quoteView .big-prompt p')).length > 10, 'a writing question');
  const sq = await js(`return quoteFor(todayISO()).text`);
  assert.ok(await js(`return seasonPool(seasonOn(todayISO())).some(q => q.text === ${JSON.stringify(sq)})`) || await js(`return seasonPool(seasonOn(todayISO())).length < 3`), 'quote suits the season');
  // a week of Lent: quotes don't repeat, and they carry a Lent theme
  const lent = await js(`const out = []; for (let d = 0; d < 7; d++) { const iso = '2027-02-1' + d; out.push(quoteFor(iso)); } return out.map(q => [q.text, q.themes]);`);
  assert.equal(new Set(lent.map(x => x[0])).size, lent.length, 'no repeats within a week');
  const lentThemes = await js(`return window.WellWriteSeasons.SEASONS.lent.themes`);
  for (const [, th] of lent) assert.ok(th.some(t => lentThemes.includes(t)), 'Lent quote has a Lent theme');
  // Another question changes the question
  const p1 = await text('#quoteView .big-prompt p');
  await js(`document.querySelector('#quoteView .big-prompt .btn-link').click();`); await wait(200);
  assert.notEqual(await text('#quoteView .big-prompt p'), p1);
  assert.ok(await js(`return document.querySelectorAll('#quoteView .season-row').length >= 12`), 'year of themes listed');
  await shot('d8-season-quote');
  await js(`await updateSetting({ quotePlan: 'spiritual' }); renderQuoteView();`); await wait(300);
  assert.equal(await js(`return document.querySelectorAll('#quoteView .season-row').length`), 12);
  await shot('d9-monthly-themes');
  await js(`await updateSetting({ quotePlan: 'off' }); renderQuoteView();`); await wait(300);
  assert.equal(await js(`return document.querySelectorAll('#quoteView .season-name').length`), 0);
  void today;

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
