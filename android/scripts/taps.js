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
    for (let i = 0; i < 5; i++) {
      await device.shell('am start -n com.chrisgribble.wellwrite/.MainActivity >/dev/null 2>&1'); await wait(1500);
      const xml = String(await device.shell('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml'));
      const node = [...xml.matchAll(/<node [^>]*>/g)].map(m => m[0]).find(x => /class="android\.webkit\.WebView"/.test(x));
      if (node) { const [, x1, y1] = node.match(/bounds="\[(\d+),(\d+)\]/).map(Number); return { x: x1, y: y1 }; }
      log('WebView not on screen yet; top:', String(await device.shell('dumpsys window | grep mCurrentFocus')).trim());
      await device.shell('input keyevent 4'); await wait(1000);
    }
    throw new Error('WellWrite never came to the front');
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
  const locked = () => is(() => !document.querySelector('#lock').hidden);
  if (await locked() && await is(() => !document.querySelector('#trustForm').hidden)) await tap('#trustOpen');
  if (await locked() && await is(() => !document.querySelector('#unlockForm').hidden)) {
    await tap('#unlockPw'); await device.shell('input text correct%shorse%s1'); await device.shell('input keyevent 66'); await wait(3000);
  }
  // Start with the keyboard put away (the camera test leaves the cursor in today's entry).
  if (await is(() => document.body.classList.contains('keyboard'))) { await device.shell('input keyevent 4'); await wait(1500); }
  check(await is(() => !document.body.classList.contains('keyboard')), 'Back puts the keyboard away');
  check(await is(() => !document.querySelector('#app').hidden), 'journal open');
  await is(() => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.body.classList.remove('drawer-open'); });

  // ---- tabs along the top
  for (const [mode, label] of [['bible', 'Bible'], ['quote', 'Week'], ['photos', 'Photos'], ['journal', 'Journal']]) {
    await tap(`.tabbar [data-mode="${mode}"]`);
    check(await is(() => document.querySelector('#page').dataset.mode) === mode, `tapping ${label} opens it`);
  }

  // ---- the Bible reader
  await tap('.tabbar [data-mode="bible"]');
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
  check(await is(() => document.querySelector('.rd-selbar').hidden && document.querySelector('#page').dataset.mode === 'bible'), 'Back clears the chosen verse and stays in the Bible');
  // Search and Plans.
  await tap('.bv-tab', 'Search');
  check(await is(() => !!document.querySelector('#bsFind')), 'Search opens');
  await shot('search');
  await tap('#bsFind'); await device.shell('input text still%swaters'); await device.shell('input keyevent 66'); await wait(2000);
  check(await is(() => document.querySelectorAll('.bs-results .bs-item').length > 0), 'searching shows results');
  await shot('search-results');
  await device.shell('input keyevent 4'); await wait(800);   // keyboard away
  await tap('.bv-tab', 'Plans');
  check(await is(() => !!document.querySelector('#bibleView .plan-opt, #bibleView .plan-day, #bibleView h2')), 'Plans opens');
  await tap('.bv-tab', 'Read');
  check(await is(() => !!document.querySelector('#rdRef')), 'back to Read');

  // ---- Back from another tab goes to the journal; the top bar's + and ⋯
  await tap('.tabbar [data-mode="photos"]');
  await device.shell('input keyevent 4'); await wait(1000);
  check(await is(() => document.querySelector('#page').dataset.mode) === 'journal', 'Back from Photos goes to the journal');
  const before = await is(() => state.current && state.current.id);
  await tap('#newTopBtn');
  check(await is(() => !!state.current && !state.current.saved), '+ starts a new entry');
  await tap('#body'); await wait(1500);
  check(await is(() => document.body.classList.contains('writing') && getComputedStyle(document.querySelector('#toolbar')).display !== 'none'), 'while writing, the formatting buttons sit above the keyboard');
  await shot('writing');
  await tap('#toolbar button'); await wait(500);
  check(await is(() => document.activeElement === document.querySelector('#body')), 'a formatting button keeps the cursor in the entry');
  await device.shell('input keyevent 4'); await wait(1500);   // keyboard away
  check(await is(() => !document.body.classList.contains('keyboard') && getComputedStyle(document.querySelector('#tabbar')).display !== 'none'), 'putting the keyboard away brings the bottom bar back');
  await shot('after-writing');
  await tap('#moreBtn');
  check(await is(() => !document.querySelector('#popover').hidden), '⋯ opens the menu');
  await shot('more');
  await tap('#popover .menu-item', 'Settings');
  check(await dialogOpen(), '⋯ → Settings opens Settings');
  await tap('.set-done');
  check(!(await dialogOpen()), 'and Done closes it');

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
  await tap('#menuBtn');
  if (await is(() => !!document.querySelector('#allEntriesBtn'))) {   // shown once there are more entries than the sidebar lists
    await tap('#allEntriesBtn');
    check(await dialogOpen(), 'All entries opens');
    await tap('#dlg .ae-list .item');
    check(!(await dialogOpen()), 'tapping an entry in All entries opens it');
  }
  await tap('#menuBtn'); await tap('#scrim');
  await is(() => document.body.classList.remove('drawer-open'));

  // ---- settings
  await tap('#menuBtn'); await tap('#settingsBtn');
  check(await dialogOpen(), 'Settings opens');
  check(await is(() => document.querySelector('.set-layout').classList.contains('at-list')), 'Settings starts with the list of sections');
  for (const t of ['general', 'readings', 'bible', 'privacy', 'backups', 'wordpress', 'about']) {
    await tap(`.set-tab[data-tab="${t}"]`);
    check(await page.evaluate(t => !document.querySelector('#set-' + t).hidden && !document.querySelector('.set-layout').classList.contains('at-list'), t).catch(() => false), `Settings: ${t} opens`);
    if (t === 'privacy') await shot('settings-section');
    if (t === 'bible') await tap('.set-back'); else { await device.shell('input keyevent 4'); await wait(900); }
    check(await is(() => document.querySelector('.set-layout').classList.contains('at-list') && !!document.querySelector('dialog[open]')), `  ${t === 'bible' ? '‹ Settings' : 'Back'} returns to the list`);
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
