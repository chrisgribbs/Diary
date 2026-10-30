'use strict';
// The weekly page: a devotional-book layout following the year of themes, with a picture for each week.
// Run: xvfb-run -a npx electron --no-sandbox test/weeks.e2e.js [shotdir]
// Set WELLWRITE_QUOTES_FILE to a quotes .txt to see the pages with a real collection.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-weeks-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-weeks-shots'));
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
  const scrollTo = sel => js(`document.querySelector('${sel}').scrollIntoView({ block: 'start' });`);

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);
  if (process.env.WELLWRITE_QUOTES_FILE) {
    const f = fs.readFileSync(process.env.WELLWRITE_QUOTES_FILE, 'utf8');
    await js(`importPreview(parsePastedQuotes(${JSON.stringify(f)}), 'file'); await new Promise(r => setTimeout(r, 300)); document.querySelector('#dlgForm').requestSubmit();`);
    await wait(1500); await js(`document.querySelector('#dlg').open && document.querySelector('#dlg').close()`);
  }

  // --- this week
  await js(`document.querySelector('.modeswitch [data-mode=quote]').click();`); await wait(900);
  const wk = await js(`return window.WellWriteWeeks.weekOf(seasonOn(todayISO()))`);
  assert.equal(await text('#quoteView .wk-title'), wk.title);
  assert.equal(await text('#quoteView .wk-number b'), String(wk.number));
  assert.match(await text('#quoteView .wk-running'), /^Theme: /);
  assert.ok(await js(`return document.querySelectorAll('#quoteView .wk-scripture p').length`) >= 5, 'verses shown');
  assert.match(await text('#quoteView .wk-scripture .wk-refs'), /\(.+, WEB\)/);
  assert.ok((await text('#quoteView .wk-prayer')).length > 20, 'a prayer');
  assert.ok((await text('#quoteView .wk-blessing')).startsWith('A Benediction'));
  assert.ok(await js(`return document.querySelectorAll('#quoteView .wk-reading').length`) >= 1, 'readings for the week');
  assert.ok(await js(`return !!document.querySelector('#quoteView .wk-reading.now')`), 'today marked');
  assert.match(await text('#quoteView .wk-today .wk-day'), /^Today/i);
  await shot('w1-this-week');
  await scrollTo('#quoteView .wk-readings'); await shot('w2-readings');
  await scrollTo('#quoteView .wk-prayer'); await shot('w3-prayer-benediction');

  // --- a picture for the week: chosen, shrunk, stored encrypted, shown, kept after locking
  await js(`const c = document.createElement('canvas'); c.width = 2400; c.height = 1200; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 1200); gr.addColorStop(0, '#7fa7c9'); gr.addColorStop(.62, '#f1d9b0'); gr.addColorStop(.63, '#4b6b5a'); gr.addColorStop(1, '#2d4136');
    g.fillStyle = gr; g.fillRect(0, 0, 2400, 1200); g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(1700, 640, 90, 0, 7); g.fill();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const url = await shrinkPicture(blob); window.__w = url.length;
    const key = window.WellWriteWeeks.weekOf(seasonOn(todayISO())).key;
    await api.setPicture(key, url); state.pictures = {}; renderQuoteView();`);
  await wait(900);
  assert.ok(await js(`return !!document.querySelector('#quoteView .wk-picture img')`), 'picture shown');
  assert.equal(await js(`return document.querySelector('#quoteView .wk-picture img').naturalWidth`), 1800, 'shrunk to 1800px');
  await js(`document.querySelector('#quoteView').scrollTop = 0`); await shot('w4-with-picture');
  await js(`document.querySelector('#lockBtn').click();`); await wait(700);
  assert.equal(await js(`return Object.keys(state.pictures).length`), 0, 'pictures cleared on lock');
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`); await wait(2500);
  assert.ok(await js(`return !!document.querySelector('#quoteView .wk-picture img')`), 'picture back after unlocking');

  // --- walk forward a whole year, week by week: no gaps, no overlaps, every week titled
  const walk = await js(`
    const out = []; let prevLast = null;
    for (let i = 0; i < 60; i++) {
      document.querySelectorAll('#quoteView .wk-nav button')[i ? document.querySelectorAll('#quoteView .wk-nav button').length - 1 : 0];
      const s = seasonOn(state.weekAt || todayISO()); const w = window.WellWriteWeeks.weekOf(s);
      const iso = state.weekAt || todayISO(); const first = addDays(iso, w.firstDay - s.dayIndex), last = addDays(iso, w.lastDay - s.dayIndex);
      out.push({ first, last, title: document.querySelector('#quoteView .wk-title').textContent, expect: w.title, season: s.id, prevLast });
      prevLast = last;
      [...document.querySelectorAll('#quoteView .wk-nav button')].at(-1).click();
      await new Promise(r => setTimeout(r, 120));
    }
    return out;`);
  for (const w of walk) {
    assert.equal(w.title, w.expect, w.first);
    if (w.prevLast) assert.equal(w.first, (d => { d.setDate(d.getDate() + 1); return d.toLocaleDateString('en-CA'); })(new Date(w.prevLast + 'T00:00:00')), 'next week starts the day after ' + w.prevLast);
  }
  const titles = walk.map(w => w.season + ': ' + w.title);
  console.log(titles.slice(0, 14).join('\n'));
  assert.ok(walk.some(w => w.season === 'christmas') && walk.some(w => w.season === 'easter') && walk.some(w => w.season === 'lent'));
  // jump to a few weeks for pictures of the book pages
  for (const [d, n] of [['2026-12-20', 'w5-advent-4'], ['2026-12-27', 'w6-christmas'], ['2027-03-29', 'w7-easter']]) {
    await js(`state.weekAt = '${d}'; renderQuoteView();`); await wait(700);
    assert.ok(await js(`return [...document.querySelectorAll('#quoteView .wk-nav button')].some(b => b.textContent === 'Back to this week')`));
    await shot(n);
  }
  await js(`[...document.querySelectorAll('#quoteView .wk-nav button')].find(b => b.textContent === 'Back to this week').click();`); await wait(500);
  assert.equal(await js(`return state.weekAt`), null);

  // --- your own writing: parsed from Title/Kind lines, shown as the week's Reflection, own prayers and blessings take turns
  const mineText = [
    'Morning light on the hills,\nand I am held.', '— Test Writer, My Psalms', 'Title: Psalm of the morning', 'Kind: Psalm, my own writing', 'Themes: Hope & renewal, Prayer, Faith & doubt, Courage & vulnerability, Gratitude, Love & belonging, Slowness & presence, Wonder & beauty, True self, Soul', '', '',
    'I walked the road and did not understand what I saw. I am still learning to stay.', '— Test Writer, Field notes', 'Title: Staying', 'Kind: Field note, mine', 'Themes: Darkness & suffering, Courage & vulnerability, Faith & doubt, Hope & renewal, Gratitude, Love & belonging, Slowness & presence, Wonder & beauty, True self, Soul', '', '',
    'Lord, keep me near when I want to run.\nAmen.', '— Test Writer', 'Kind: Prayer, my own writing', 'Themes: Prayer, Courage & vulnerability, Faith & doubt, Hope & renewal, Gratitude, Love & belonging, Slowness & presence, Wonder & beauty, True self, Soul', '', '',
    'May the road rise gently under you.', '— Test Writer', 'Kind: Blessing, my own writing', 'Themes: Blessing, Hope & renewal, Prayer, Courage & vulnerability, Faith & doubt, Gratitude, Love & belonging, Slowness & presence, Wonder & beauty, True self, Soul',
  ].join('\n');
  // a dash list inside a poem is not a writer's name
  const listPoem = await js(`return parsePastedQuotes(${JSON.stringify('Keep me from\n– Pride;\n– Arrogance;\n– Contempt.\nAnd hold me.\n— Test Writer, My Psalms')})`);
  assert.equal(listPoem.length, 1);
  assert.equal(listPoem[0].text, 'Keep me from\n– Pride;\n– Arrogance;\n– Contempt.\nAnd hold me.');
  assert.equal(listPoem[0].author, 'Test Writer');
  const parsedMine = await js(`return parsePastedQuotes(${JSON.stringify(mineText)})`);
  assert.deepEqual(parsedMine.map(q => [q.kind, !!q.mine, q.title || '']), [['psalm', true, 'Psalm of the morning'], ['fieldnote', true, 'Staying'], ['prayer', true, ''], ['blessing', true, '']]);
  assert.equal(parsedMine[0].text, 'Morning light on the hills,\nand I am held.');
  const back = await js(`return parsePastedQuotes(quotesAsText(${JSON.stringify(parsedMine)}))`);
  assert.deepEqual(back, parsedMine, 'own writing round-trips through export');
  await js(`await saveQuotes([...state.quotes, ...${JSON.stringify(parsedMine)}]); state.weekAt = null; renderQuoteView();`); await wait(900);
  assert.ok(await js(`return !!document.querySelector('#quoteView .wk-reflection')`), 'a reflection from your own writing');
  assert.match(await text('#quoteView .wk-reflection h4'), /^(A Psalm|A Poem|A Reflection|From the field)/);
  const real = !!process.env.WELLWRITE_QUOTES_FILE;   // with a real collection, other writing may be chosen
  if (!real) assert.match(await text('#quoteView .wk-reflection .wk-sign'), /Test Writer/);
  // across two neighbouring weeks, your prayer and your blessing each appear once
  let sawPrayer = false, sawBlessing = false;
  for (let i = 0; i < 2; i++) {
    if (await js(`return document.querySelector('#quoteView .wk-prayer').innerText.includes('keep me near when I want to run')`)) sawPrayer = true;
    if (await js(`return document.querySelector('#quoteView .wk-blessing').innerText.includes('road rise gently')`)) sawBlessing = true;
    await js(`[...document.querySelectorAll('#quoteView .wk-nav button')].at(-1).click();`); await wait(600);
  }
  if (!real) assert.ok(sawPrayer && sawBlessing, 'own prayer and blessing used in alternate weeks');
  await js(`state.weekAt = null; renderQuoteView();`); await wait(700);
  await scrollTo('#quoteView .wk-reflection'); await shot('w10-own-reflection');
  // the editor shows kind, title and the mark
  await js(`quoteThemeFilter = '\u0000mine'; manageQuotes();`); await wait(500);
  if (!real) assert.equal(await js(`return document.querySelectorAll('#dlg .q-row').length`), 4);
  assert.match(await text('#dlg .q-row .q-kind'), /my own writing/);
  await shot('w11-my-writing-filter');
  // delete everything shown, in two clicks
  const before = await js(`return state.quotes.length`), mineN = await js(`return state.quotes.filter(q => q.mine).length`);
  await js(`document.querySelector('#deleteShown').click();`); await wait(100);
  assert.match(await text('#deleteShown'), /Click again/);
  assert.equal(await js(`return state.quotes.length`), before, 'nothing deleted on the first click');
  await js(`document.querySelector('#deleteShown').click();`); await wait(600);
  assert.equal(await js(`return state.quotes.length`), before - mineN);
  assert.equal(await js(`return state.quotes.filter(q => q.mine).length`), 0);
  await js(`document.querySelector('#dlg').close(); quoteThemeFilter = '';`);

  // --- monthly themes use the same layout
  await js(`await updateSetting({ quotePlan: 'spiritual' }); renderQuoteView();`); await wait(700);
  assert.match(await text('#quoteView .wk-running'), /Theme: /);
  await shot('w8-monthly');

  // --- dark theme
  await js(`await updateSetting({ quotePlan: 'christian', theme: 'dark' }); renderQuoteView();`); await wait(800);
  await shot('w9-dark');

  assert.deepEqual(errors, [], 'no console errors');
  console.log('weeks e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
