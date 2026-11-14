'use strict';
// Listening to the Bible: the Listen button, the player, the right chapter from eBible.org, going on to the next
// chapter (the reader following), speed, stopping, offline, and the player on a phone-sized window.
// Run: xvfb-run -a npx electron --no-sandbox test/listen.e2e.js
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-listen-e2e-'));
const OUT = path.join(os.tmpdir(), 'wellwrite-listen-shots'); fs.mkdirSync(OUT, { recursive: true });
const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const { getWindow } = require('../main.js');
const audio = require('../src/audio/web-henson.json');
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 860);
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 140)); });
  const shot = async n => { await wait(300); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const errors = [];
  win.webContents.on('console-message', (e, level, msg) => { if (level >= 3 && !/ebible\.org|ERR_|Failed to load/i.test(msg)) errors.push(msg); });

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);

  // John 3 in the reader, then Listen.
  await js(`setReaderPos(42, 3); state.bibleTab = 'read'; setMode('bible');`); await wait(1200);
  assert(await js(`return !!document.querySelector('.rd-listen')`), 'a Listen button');
  await js(`document.querySelector('.rd-listen').click();`); await wait(800);
  assert(await js(`return !document.querySelector('#listenBar').hidden`), 'the player shows');
  assert.equal(await js(`return listen.audio.src`), audio.base + audio.files[42][2], 'John 3 from eBible.org');
  assert.equal(await js(`return document.querySelector('.ls-title').textContent`), 'John 3');
  assert(await js(`return document.querySelector('.rd-listen').classList.contains('on')`));
  await shot('l1-player');

  if (process.env.WELLWRITE_LISTEN_ONLINE) {
    // With the internet (the GitHub check): it really plays, and skipping ahead works.
    let t = 0; for (let i = 0; i < 40 && t < 3; i++) { await wait(500); t = await js(`return listen.audio.currentTime`); }
    assert(t >= 3, 'playing: ' + t + 's in');
    assert(await js(`return !listen.audio.paused && listen.audio.duration > 120`), 'a whole chapter');
    const before = await js(`return listen.audio.currentTime`);
    await js(`document.querySelectorAll('.ls-skip')[1].click();`); await wait(300);
    assert(await js(`return listen.audio.currentTime`) >= before + 14, 'forward 15 seconds');
    await js(`listen.audio.currentTime = 200;`); await wait(2500);
    assert(await js(`return listen.audio.currentTime > 200 && !listen.audio.paused`), 'skipping ahead (range requests) works');
    console.log('  played John 3 from eBible.org:', Math.round(await js(`return listen.audio.duration`)), 's long');
    await js(`listen.audio.pause();`);
  } else {
    // No internet here: a plain message, not a broken player.
    await wait(1500);
    const note = await js(`return document.querySelector('.ls-note').textContent`);
    assert(/Loading|Couldn’t play|Offline/.test(note), 'says what is happening: ' + note);
    assert(await js(`return listen.audio.paused || document.querySelector('.ls-note').textContent === 'Loading…'`), 'not pretending to play');
  }

  // Speed
  await js(`document.querySelector('.ls-rate').click();`);
  assert.equal(await js(`return listen.audio.playbackRate`), 1.25);
  assert.equal(await js(`return document.querySelector('.ls-rate').textContent`), '1.25×');

  // The end of the chapter: on to John 4, and the reader follows.
  await js(`listen.audio.dispatchEvent(new Event('ended'));`); await wait(1200);
  assert.equal(await js(`return listen.audio.src`), audio.base + audio.files[42][3], 'John 4 next');
  assert.equal(await js(`return document.querySelector('.ls-title').textContent`), 'John 4');
  assert.deepEqual(await js(`return state.readerPos`), { b: 42, c: 4 }, 'the reader followed');
  assert.equal(await js(`return listen.audio.playbackRate`), 1.25, 'the speed stays');

  // Reading something else: listening carries on, the reader stays put.
  await js(`setReaderPos(0, 1); renderBibleView();`); await wait(800);
  await js(`listen.audio.dispatchEvent(new Event('ended'));`); await wait(800);
  assert.equal(await js(`return document.querySelector('.ls-title').textContent`), 'John 5');
  assert.deepEqual(await js(`return state.readerPos`), { b: 0, c: 1 }, 'the reader stays where you were');

  // The end of a book: on to the next book.
  await js(`listenTo({ b: 42, c: 21 });`); await wait(500);
  await js(`listen.audio.dispatchEvent(new Event('ended'));`); await wait(800);
  assert.equal(await js(`return document.querySelector('.ls-title').textContent`), 'Acts 1');

  // Leaving the Bible: the player stays.
  await js(`setMode('journal');`); await wait(500);
  assert(await js(`return !document.querySelector('#listenBar').hidden`), 'still there in the journal');
  await shot('l2-journal');

  // Locked: it keeps going but isn't shown over the lock screen.
  await js(`await lockNow();`); await wait(800);
  assert(await js(`return getComputedStyle(document.querySelector('#listenBar')).display === 'none' && !!listen.pos`), 'hidden, still listening');
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`); await wait(2000);
  assert(await js(`return getComputedStyle(document.querySelector('#listenBar')).display !== 'none'`), 'back after unlocking');

  // Stop
  await js(`document.querySelector('.ls-close').click();`); await wait(300);
  assert(await js(`return document.querySelector('#listenBar').hidden && !listen.pos && !listen.audio.getAttribute('src')`), 'stopped');

  // A phone-sized window: the player sits above the tab bar, nothing off-screen.
  // (the window won't go narrower than 820px here, so zoom in to make the page 400px wide)
  win.webContents.setZoomFactor(win.getContentSize()[0] / 400); await wait(800);
  await js(`setReaderPos(18, 23); state.bibleTab = 'read'; setMode('bible');`); await wait(1000);
  await js(`document.querySelector('.rd-listen').click();`); await wait(800);
  const r = await js(`const b = document.querySelector('#listenBar').getBoundingClientRect(), t = document.querySelector('.tabbar').getBoundingClientRect();
    const out = [...document.querySelectorAll('#listenBar button, #listenBar input')].filter(e => { const x = e.getBoundingClientRect(); return x.left < 0 || x.right > innerWidth + 1; }).length;
    return { bottom: Math.round(b.bottom), tabTop: Math.round(t.top), left: Math.round(b.left), right: Math.round(b.right), w: innerWidth, out }`);
  console.log('  phone:', JSON.stringify(r));
  assert(r.bottom <= r.tabTop, 'above the tab bar');
  assert(r.left >= 0 && r.right <= r.w && r.out === 0, 'nothing off-screen');
  await shot('l3-phone');
  // The reader's bar on a phone: one line, short book name, no second Search, nothing cut off.
  await js(`setReaderPos(51, 5); renderBibleView();`); await wait(900);
  const bar = await js(`const b = document.querySelector('.rd-bar'), ref = document.querySelector('.rd-ref');
    const shown = [...b.children].filter(e => getComputedStyle(e).display !== 'none');
    return { h: Math.round(b.getBoundingClientRect().height), find: getComputedStyle(document.querySelector('.rd-find')).display,
      ref: document.querySelector('.rd-ref-short').textContent, cut: ref.scrollWidth > ref.clientWidth + 1,
      tops: new Set(shown.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))).size }`);
  console.log('  phone reader bar:', JSON.stringify(bar));
  assert(bar.h < 60 && bar.tops === 1, 'one line');
  assert.equal(bar.find, 'none');
  assert.equal(bar.ref, '1 Thess 5');
  assert(!bar.cut, 'the book and chapter fit');
  // The Message numbers its paragraphs, not verses: no "0" verse numbers.
  assert(await js(`return ![...document.querySelectorAll('.rd-v sup')].some(s => s.textContent === '0')`));

  assert.deepEqual(errors, [], 'no console errors');
  console.log('listen e2e passed; shots in ' + OUT);
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
