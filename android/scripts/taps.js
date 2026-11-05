'use strict';
// Real finger taps on the emulator (adb "input tap", not scripted clicks), through the screens people move
// around most: the Bible reader and its passage picker, the sidebar, the tabs, settings. Runs after drive.js.
// Each step checks the app did what the tap asked. Screenshots go to smoke/tap-*.png.
const { _android } = require('playwright-core');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0, n = 0;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failures++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const [device] = await _android.devices();
  const webview = await device.webView({ pkg: 'com.chrisgribble.wellwrite' }, { timeout: 60000 });
  const page = await webview.page();
  page.on('pageerror', e => log('pageerror', e.message));
  const shot = async name => { await device.screenshot({ path: `smoke/tap-${String(++n).padStart(2, '0')}-${name}.png` }); };

  // Where the WebView is on the screen, in device pixels.
  const webviewBox = async () => {
    const xml = String(await device.shell('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml'));
    const node = [...xml.matchAll(/<node [^>]*>/g)].map(m => m[0]).find(x => /class="android\.webkit\.WebView"/.test(x));
    const [, x1, y1] = node.match(/bounds="\[(\d+),(\d+)\]/).map(Number);
    return { x: x1, y: y1 };
  };
  const box = await webviewBox();
  const dpr = await page.evaluate(() => devicePixelRatio);
  log('webview at', box, 'dpr', dpr);
  /** Tap the middle of the first visible element matching a selector (or containing text), with a real touch. */
  const tap = async (selector, text) => {
    const r = await page.evaluate(([sel, text]) => {
      const els = [...document.querySelectorAll(sel)].filter(e => e.checkVisibility() && (!text || e.textContent.trim().includes(text)));
      const e = els[0]; if (!e) return null;
      e.scrollIntoView({ block: 'nearest' });
      const b = e.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }, [selector, text || '']);
    if (!r) { log('nothing to tap:', selector, text || ''); return false; }
    await wait(250);
    await device.shell(`input tap ${Math.round(box.x + r.x * dpr)} ${Math.round(box.y + r.y * dpr)}`);
    await wait(1200);
    return true;
  };
  const is = fn => page.evaluate(fn).catch(() => null);
  const dialogOpen = () => is(() => !!document.querySelector('dialog[open]'));

  // Open the journal.
  await wait(2000);
  if (await is(() => !document.querySelector('#trustForm').hidden)) await tap('#trustOpen');
  if (await is(() => !document.querySelector('#unlockForm').hidden)) {
    await tap('#unlockPw'); await device.shell("input text 'correct\\ horse\\ 1'"); await device.shell('input keyevent 66'); await wait(3000);
  }
  check(await is(() => !document.querySelector('#app').hidden), 'journal open');
  await is(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.body.classList.remove('drawer-open'); });

  // ---- tabs along the top
  for (const [mode, label] of [['bible', 'Bible'], ['quote', 'Week'], ['photos', 'Photos'], ['journal', 'Journal']]) {
    await tap(`.modeswitch [data-mode="${mode}"]`);
    check(await is(() => document.querySelector('#page').dataset.mode) === mode, `tapping ${label} opens it`);
  }

  // ---- the Bible reader
  await tap('.modeswitch [data-mode="bible"]');
  await tap('.bv-tab', 'Read'); await wait(800);
  const ref0 = await is(() => document.querySelector('#rdRef') && document.querySelector('#rdRef').textContent.trim());
  await shot('bible');
  await tap('.rd-arrow', '›');
  const ref1 = await is(() => document.querySelector('#rdRef').textContent.trim());
  check(ref1 && ref1 !== ref0, `› goes to the next chapter (${ref0} → ${ref1})`);
  await tap('.rd-arrow', '‹');
  check(await is(() => document.querySelector('#rdRef').textContent.trim()) === ref0, '‹ goes back');
  await tap('#rdRef');
  check(await dialogOpen(), 'tapping the chapter name opens “Choose a passage”');
  await shot('picker');
  await tap('#dlg .btn-plain', 'Close');
  check(!(await dialogOpen()), 'Close closes “Choose a passage”');
  await tap('#rdRef');
  await tap('.bp-book', 'Genesis');
  check(await is(() => !!document.querySelector('.bp-chapters')), 'tapping Genesis shows its chapters');
  await shot('chapters');
  await tap('.bp-ch', '3');
  check(!(await dialogOpen()) && /Genesis 3/.test(await is(() => document.querySelector('#rdRef').textContent)), 'tapping 3 opens Genesis 3');
  await shot('genesis3');
  await tap('#rdRef'); await tap('.bp-book', 'Ruth'); await tap('.bp-ch', '2');
  check(/Ruth 2/.test(await is(() => document.querySelector('#rdRef').textContent)), 'Ruth 2 opens');
  // Next/previous at the bottom of the chapter.
  await is(() => { document.querySelector('#sheetScroll').scrollTop = 1e6; });
  await wait(600);
  await tap('.rd-foot button', '›');
  check(/Ruth 3/.test(await is(() => document.querySelector('#rdRef').textContent)), 'the button at the end goes on to Ruth 3');
  // Version menu.
  await tap('.rd-bar .version-btn');
  check(await is(() => !document.querySelector('#popover').hidden), 'the version ▾ opens the list');
  await shot('versions');
  await tap('#popover button', 'King James');
  check(await is(() => document.querySelector('#popover').hidden), 'choosing a version closes the list');
  await tap('.rd-bar .version-btn'); await tap('#popover button', 'World English');
  // A verse, then its bar.
  await tap('.rd-v');
  check(await is(() => !!document.querySelector('.rd-selbar')), 'tapping a verse selects it');
  await shot('verse');
  await device.shell('input keyevent 4'); await wait(800);
  // Search and Plans.
  await tap('.bv-tab', 'Search');
  check(await is(() => !!document.querySelector('#bsFind')), 'Search opens');
  await shot('search');
  await tap('#bsFind'); await device.shell("input text 'still\\ waters'"); await device.shell('input keyevent 66'); await wait(2000);
  check(await is(() => document.querySelectorAll('.bs-results .bs-item').length > 0), 'searching shows results');
  await shot('search-results');
  await device.shell('input keyevent 4'); await wait(800);   // keyboard away
  await tap('.bv-tab', 'Plans');
  check(await is(() => !!document.querySelector('#bibleView .plan-opt, #bibleView .plan-day, #bibleView h2')), 'Plans opens');
  await tap('.bv-tab', 'Read');
  check(await is(() => !!document.querySelector('#rdRef')), 'back to Read');

  // ---- the sidebar
  await tap('#menuBtn');
  check(await is(() => document.body.classList.contains('drawer-open')), 'the menu button opens the sidebar');
  await shot('drawer');
  await tap('.sidetabs [data-view="categories"]'); await tap('.sidetabs [data-view="tags"]'); await tap('.sidetabs [data-view="calendar"]');
  check(await is(() => document.body.classList.contains('drawer-open')), 'the sidebar tabs keep it open');
  await tap('#calNext'); await tap('#calPrev');
  await tap('#list .item');
  check(await is(() => !document.body.classList.contains('drawer-open') && document.querySelector('#page').dataset.mode === 'journal' && !document.querySelector('#sheet').hidden), 'tapping an entry opens it and closes the sidebar');
  await shot('entry');
  await tap('#menuBtn'); await tap('#allEntriesBtn');
  check(await dialogOpen(), 'All entries opens');
  await tap('#dlg .ae-list .item');
  check(!(await dialogOpen()), 'tapping an entry in All entries opens it');
  await tap('#menuBtn'); await tap('#scrim');
  await is(() => document.body.classList.remove('drawer-open'));

  // ---- settings
  await tap('#menuBtn'); await tap('#settingsBtn');
  check(await dialogOpen(), 'Settings opens');
  for (const t of ['readings', 'bible', 'privacy', 'backups', 'wordpress', 'about']) {
    await tap(`.set-tab[data-tab="${t}"]`);
    check(await is(t => !document.querySelector('#set-' + t).hidden, t), `Settings: ${t} tab`);
  }
  await shot('settings');
  await tap('.set-done');
  check(!(await dialogOpen()), 'Done closes Settings');

  // ---- the entry: category, tags, date
  await tap('#catPill');
  check(await is(() => !document.querySelector('#popover').hidden), 'the category button opens its menu');
  await device.shell('input keyevent 4'); await wait(800);
  await is(() => closePopover());

  log(failures ? `${failures} TAP CHECKS FAILED` : 'ALL TAP CHECKS PASSED');
  await device.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { log('ERROR', e.stack || e.message); process.exit(2); });
