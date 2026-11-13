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
  // Swipes, with a real finger.
  const swipe = async dir => {
    const r = await page.evaluate(() => { const b = document.querySelector('.rd-text').getBoundingClientRect(); return { y: Math.min(b.top + 260, innerHeight - 120), w: innerWidth }; });
    const y = Math.round(box.y + r.y * dpr), a = Math.round(r.w * 0.78 * dpr), b = Math.round(r.w * 0.22 * dpr);
    await device.shell(dir === 'left' ? `input swipe ${a} ${y} ${b} ${y} 180` : `input swipe ${b} ${y} ${a} ${y} 180`);
    await wait(1500);
  };
  await swipe('left');
  check(await is(() => document.querySelector('#rdRef').textContent.trim()) === ref1, `swiping left goes to the next chapter (${ref1})`);
  await shot('swiped');
  await swipe('right');
  check(await is(() => document.querySelector('#rdRef').textContent.trim()) === ref0, 'swiping right goes back');
  await is(() => { document.querySelector('#sheetScroll').scrollTop = 0; });
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

  // ---- one photo: a tap opens it with Delete (no keyboard)
  await is(() => { const m = state.metas.find(x => x.images > 0); return m && openEntry(m.id); });
  await wait(800);
  await is(() => { const i = document.querySelector('#body img'); if (i) i.scrollIntoView({ block: 'center' }); });
  await tap('#body img');
  check(await is(() => !document.querySelector('#lightbox').hidden && !document.querySelector('#lbDelete').hidden), 'tapping a photo opens it, with Delete photo');
  check(await is(() => !document.body.classList.contains('keyboard')), '…without bringing up the keyboard');
  await shot('photo');
  await tap('#lbDelete');
  check(await dialogOpen(), 'Delete photo asks first');
  await tap('#dlg .btn-plain', 'Cancel');
  await tap('#lbClose');
  check(await is(() => document.querySelector('#lightbox').hidden), 'Close closes the photo');

  // ---- the entry: category, tags, date
  await tap('#catPill');
  check(await is(() => !document.querySelector('#popover').hidden), 'the category button opens its menu');
  await device.shell('input keyevent 4'); await wait(800);
  await is(() => closePopover());

  // Updates: WellWrite downloads the release itself and refuses a file that isn't signed with its own key
  // (this test copy is signed with a test key, so the real release must be refused).
  const upd = await page.evaluate(() => new Promise(resolve => {
    const seen = [];
    window.wellwrite.onUpdateProgress(p => { seen.push(p); if (p.error || p.ready) resolve(seen); });
    window.WellWriteNative.postMessage('N' + JSON.stringify({ id: 999999, op: 'downloadUpdate', url: 'https://github.com/chrisgribbs/Diary/releases/download/v1.20.1/WellWrite-1.20.1.apk', version: '1.20.1', auto: false }));
    setTimeout(() => resolve(seen), 90000);
  }));
  log('update progress:', JSON.stringify(upd.slice(-3)));
  check(upd.some(p => p.downloading) && upd.some(p => p.error && /signed/.test(p.error)), 'the app downloads an update itself and checks who signed it');

  // ---- the prayer bell: turned on, a bell from Android's alarm clock (with WellWrite in the background),
  // its notification and "Mute today", and tapping it opens Pause for prayer.
  await device.shell('pm grant com.chrisgribble.wellwrite android.permission.POST_NOTIFICATIONS');
  await is(() => updateSetting({ prayerBell: true, prayerMutedOn: '' }));
  await wait(1500);
  const soon = Date.now() + 25000;
  const sched = await page.evaluate(at => window.wellwrite.prayerSchedule({ sound: 'bell', bells: [{ at, key: 'midday', date: new Date(at).toISOString().slice(0, 10), title: 'Midday prayer', body: 'Be still, and know that I am God. — Psalm 46:10' }] }), soon).catch(e => ({ error: e.message }));
  log('scheduled:', JSON.stringify(sched));
  await device.shell('input keyevent 3');   // Home: WellWrite in the background
  await wait(40000);
  const notes = String(await device.shell("dumpsys notification --noredact | grep -iE 'prayer_bell_3|Midday prayer' | head -10"));
  log('notifications:', notes.replace(/\s+/g, ' ').slice(0, 400));
  check(/Midday prayer|prayer_bell_3/.test(notes), 'the bell rings from the alarm clock with WellWrite in the background');
  await device.shell('cmd statusbar expand-notifications'); await wait(1500); await shot('bell-notification');
  // Tap it: WellWrite opens at Pause for prayer.
  const xml = String(await device.shell('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml'));
  const bellNode = [...xml.matchAll(/<node [^>]*>/g)].map(m => m[0]).find(x => /text="Midday prayer"/.test(x));
  if (bellNode) { const [, x1, y1, x2, y2] = bellNode.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).map(Number); await device.shell(`input tap ${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`); }
  else await device.shell('cmd statusbar collapse');
  await wait(4000);
  check(await is(() => !!document.querySelector('.prayer-pause')), 'tapping the bell opens Pause for prayer');
  await shot('pause-for-prayer');
  await is(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
  // "Mute today" from the notification's button.
  await page.evaluate(() => window.wellwrite.prayerTest()); await wait(2000);
  await device.shell('cmd statusbar expand-notifications'); await wait(1500);
  const xml2 = String(await device.shell('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml'));
  const mb = [...xml2.matchAll(/<node [^>]*>/g)].map(m => m[0]).find(x => /text="(Mute today|MUTE TODAY)"/i.test(x));
  if (mb) { const [, x1, y1, x2, y2] = mb.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).map(Number); await device.shell(`input tap ${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`); }
  else log('no Mute today button visible (the notification may be collapsed)');
  await wait(1500); await device.shell('cmd statusbar collapse'); await wait(800);
  await device.shell('am start -n com.chrisgribble.wellwrite/.MainActivity'); await wait(2500);
  const r2 = await page.evaluate(() => syncPrayerBell().then(() => mutedToday())).catch(() => null);
  check(r2 === true, '“Mute today” on the notification mutes the bell in WellWrite too');
  await is(() => updateSetting({ prayerBell: false }));

  log(failures ? `${failures} TAP CHECKS FAILED` : 'ALL TAP CHECKS PASSED');
  await device.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { log('ERROR', e.stack || e.message); process.exit(2); });
