'use strict';
// The prayer for today: the Daily prayers collection loads, a prayer shows under the quote and verse with its credit,
// "I like this" and "Not for me" (with Undo), Another, Hide today, the setting, the morning Pause for prayer,
// and sharing prayers in a pack that imports again with credits and licences intact.
// Run: xvfb-run -a npx electron --no-sandbox test/daily-prayers.e2e.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-dp-e2e-'));
const OUT = path.join(os.tmpdir(), 'wellwrite-daily-prayer-shots'); fs.mkdirSync(OUT, { recursive: true });
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 1000);
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 140)); });
  const shot = async n => { await wait(300); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const card = `document.querySelector('#quoteSlot .quote-card.prayer')`;
  const click = label => js(`[...${card}.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(label)})).click();`);

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(3000);

  // The collection is there: 365 prayers, each with its credit and licence.
  assert.equal(await js(`return state.quotes.filter(q => q.pack === 'prayers').length`), 365);
  assert(await js(`return state.quotes.filter(q => q.pack === 'prayers').every(q => q.credit && q.licence)`));

  // Today's entry shows the prayer for today, under the quote and verse, with its credit.
  await js(`await newEntry(todayISO());`); await wait(1500);
  assert(await js(`return !!${card}`), 'a prayer card above the entry');
  const first = await js(`return prayerFor(todayISO()).id`);
  assert.match(await js(`return ${card}.querySelector('.q-season').textContent`), /^Prayer for (this morning|today|this evening)/);
  assert.equal(await js(`return ${card}.querySelector('.q-season').textContent.split(' · ')[0]`),
    await js(`return ({ morning: 'Prayer for this morning', day: 'Prayer for today', evening: 'Prayer for this evening' })[WellWritePrayerTimes.partOfDay()]`));

  // Three prayers a day: morning, day and evening, all different; a morning prayer never in the evening, nor the reverse.
  const year = await js(`
    const T = WellWritePrayerTimes, y = new Date().getFullYear(), out = { days: 0, same: 0, wrong: 0, timedMorning: 0, timedEvening: 0, missing: 0 };
    const plan = yearPlan(y);
    for (const [d, p] of plan.prayers) {
      out.days++;
      if (!p.morning || !p.day || !p.evening) { out.missing++; continue; }
      if (new Set([p.morning.id, p.day.id, p.evening.id]).size < 3) out.same++;
      if (T.prayerTime(p.morning) === 'evening' || T.prayerTime(p.evening) === 'morning' || T.prayerTime(p.day)) out.wrong++;
      if (T.prayerTime(p.morning) === 'morning') out.timedMorning++;
      if (T.prayerTime(p.evening) === 'evening') out.timedEvening++;
    }
    // Easter Day's own prayer, in the morning
    const ed = WellWriteSeasons.easter(y), e = plan.prayers.get(ed);
    out.easter = e && e.morning && e.morning.occasion;
    out.ids = ['morning', 'day', 'evening'].map(k => prayerFor(todayISO(), k).id);
    return out;`);
  console.log('  year of prayers:', JSON.stringify({ ...year, ids: undefined }));
  assert(year.days >= 365, 'a plan for every day');
  assert.equal(year.missing, 0, 'three prayers every day');
  assert.equal(year.same, 0, 'never the same prayer twice in a day');
  assert.equal(year.wrong, 0, 'each prayer at its own hour');
  assert(year.timedMorning > 100 && year.timedEvening > 100, 'morning and evening prayers come often');
  assert(year.easter, 'Easter Day has its own prayer in the morning');
  assert.equal(new Set(year.ids).size, 3, "today's three prayers differ");
  assert(await js(`return ${card}.querySelector('blockquote').textContent.length > 30`));
  // The credit: one line, with "Credit" to see it all (the licence's full credit is a click away).
  assert.equal(await js(`return ${card}.querySelector('.q-attr-btn').textContent`), 'Credit');
  assert(await js(`return ${card}.querySelector('.q-attr-more').hidden`), 'the full credit starts folded');
  assert(await js(`const l = ${card}.querySelector('.q-attr'); return l.getBoundingClientRect().height < 30`), 'one line');
  await js(`${card}.querySelector('.q-attr-btn').click();`);
  assert.match(await js(`return ${card}.querySelector('.q-attr-more').textContent`), /(Used with permission|Public domain)[\s\S]*Licence:/);
  await js(`${card}.querySelector('.q-attr-line').click();`);
  assert(await js(`return ${card}.querySelector('.q-attr-more').hidden`), 'folds again');
  await shot('d1-card');

  // I like this: a favourite, shown as liked.
  await click('I like this'); await wait(600);
  assert(await js(`return state.quotes.find(q => q.id === ${JSON.stringify(first)}).fav`), 'liked');
  assert.match(await js(`return ${card}.querySelector('.q-like').textContent`), /You like this/);

  // Not for me: gone from your prayers, with Undo; then gone for good, and another comes.
  await click('Not for me'); await wait(600);
  assert(!(await js(`return state.quotes.some(q => q.id === ${JSON.stringify(first)})`)), 'removed');
  assert.match(await js(`return ${card}.querySelector('.q-gone').textContent`), /won’t come again/);
  await shot('d2-not-for-me');
  await click('Undo'); await wait(600);
  assert(await js(`return state.quotes.some(q => q.id === ${JSON.stringify(first)})`), 'undone');
  await click('Not for me'); await wait(500);
  await click('Show another'); await wait(600);
  const second = await js(`return prayerFor(todayISO()).id`);
  assert.notEqual(second, first, 'a different prayer');
  assert(!(await js(`return state.quotes.some(q => q.id === ${JSON.stringify(first)})`)), 'still gone');

  // Another: the next prayer that suits today.
  await click('Another'); await wait(500);
  assert.notEqual(await js(`return prayerFor(todayISO()).id`), second);

  // In the morning, Pause for prayer prays the day's prayer.
  const today = await js(`return prayerFor(todayISO()).text`);
  await js(`pauseForPrayer('morning');`); await wait(800);
  assert.equal(await js(`return document.querySelector('.pp-prayer p').textContent`), today);
  await shot('d3-pause');
  await js(`document.querySelector('#dlg').close();`); await wait(300);

  // Sharing: liked prayers and your own go in a pack, with their credit; a changed copy of a licensed prayer doesn't.
  await js(`const ps = state.quotes.filter(q => q.pack === 'prayers');
    await saveQuotes(state.quotes.map(q => q.id === ps[1].id || q.id === ps[2].id ? { ...q, fav: true } : q.id === ps[3].id ? { ...q, fav: true, text: q.text + ' (changed)' } : q)
      .concat([{ text: 'Lord of this quiet morning, find me here.', author: 'Chris Gribble', kind: 'prayer', mine: true, themes: ['Prayer'] }]));`);
  await wait(500);
  await js(`sharePrayers();`); await wait(600);
  await js(`document.querySelectorAll('#dlg input[type=checkbox]')[1].click();`); await wait(200);   // and your own prayers
  assert.match(await js(`return document.querySelector('#dlg .muted').textContent`), /^3 prayers will go in the pack.*1 can’t be shared/);
  await shot('d4-share');
  await js(`document.querySelector('#dlg').close();`);
  const back = await js(`const all = state.quotes.filter(q => q.kind === 'prayer' && (q.fav || q.mine)).map(q => shareable(q, 'Chris')).filter(Boolean);
    return parsePastedQuotes(quotesAsText(all)).map(q => ({ author: q.author, licence: q.licence, credit: q.credit, mine: !!q.mine }));`);
  assert.equal(back.length, 3);
  assert(back.every(q => q.credit && q.licence && !q.mine), 'every shared prayer keeps its credit and licence, and isn’t "my own" for whoever imports it');
  assert(back.some(q => q.author === 'Chris' && q.licence === 'own'), 'your own prayer, under your name');

  // The setting turns it off.
  await js(`await updateSetting({ dailyPrayer: false }); refreshQuote();`); await wait(600);
  assert(!(await js(`return !!${card}`)), 'no prayer card when it’s off');
  await js(`await updateSetting({ dailyPrayer: true }); refreshQuote();`); await wait(600);
  await click('Hide today'); await wait(500);
  assert(!(await js(`return !!${card}`)), 'hidden today');

  console.log('daily prayers e2e passed; screenshots in', OUT);
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
