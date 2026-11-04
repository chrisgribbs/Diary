'use strict';
// Drives WellWrite on the emulator (debug build) through its WebView, checking the main things work.
// Needs playwright-core (npm i --no-save playwright-core). Screenshots go to smoke/.
const { _android } = require('playwright-core');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
let failures = 0;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failures++; };

(async () => {
  const [device] = await _android.devices();
  if (!device) throw new Error('No emulator');
  const shot = async n => { await device.screenshot({ path: `smoke/${n}.png` }); log('shot', n); };
  const webview = await device.webView({ pkg: 'com.chrisgribble.wellwrite' }, { timeout: 60000 });
  const page = await webview.page();
  page.on('console', m => log('console', m.type(), m.text()));
  page.on('pageerror', e => log('pageerror', e.message));

  await page.waitForSelector('#setupForm:not([hidden]), #unlockForm:not([hidden])', { timeout: 60000 });
  check(await page.evaluate(() => window.wellwrite && window.wellwrite.platform === 'android'), 'page talks to the Android app');
  await shot('2-lock');

  await page.fill('#setupPw', 'correct horse 1');
  await page.fill('#setupPw2', 'correct horse 1');
  await page.click('#setupBtn');
  await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot('3-home');

  const st = await page.evaluate(() => window.wellwrite.status());
  check(st.exists && st.unlocked, 'journal created and open: ' + JSON.stringify({ dataDir: st.dataDir, trust: st.trust }));
  check(st.trust && st.trust.available, 'this phone can keep a remembered password (keystore)');

  const saved = await page.evaluate(() => window.wellwrite.save({ date: new Date().toISOString().slice(0, 10), title: 'Ngā mihi — a walk 🌿', html: '<p>Quiet, grateful. “Be still.” Ünïcode ✓</p>', tags: ['walk'] }));
  const back = await page.evaluate(id => window.wellwrite.get(id), saved.id);
  check(back.title === 'Ngā mihi — a walk 🌿' && back.html.includes('Ünïcode ✓'), 'an entry with emoji and accents saves and reads back exactly');

  await page.evaluate(() => location.reload());
  await page.waitForTimeout(4000);
  await page.waitForSelector('#unlockForm:not([hidden]), #app:not([hidden])', { timeout: 30000 });
  if (await page.isVisible('#unlockForm')) {
    await page.fill('#unlockPw', 'correct horse 1');
    await page.click('#unlockBtn');
    await page.waitForSelector('#app:not([hidden])', { timeout: 30000 });
  }
  check((await page.evaluate(() => window.wellwrite.list())).length === 1, 'the entry is still there after reopening');
  await page.waitForTimeout(1500);
  await shot('4-journal');

  await page.click('#menuBtn'); await page.waitForTimeout(800); await shot('5-drawer');
  check(await page.evaluate(() => document.body.classList.contains('drawer-open')), 'the menu button opens the sidebar');
  await device.shell('input keyevent 4');   // the Back button
  await page.waitForTimeout(800);
  check(!(await page.evaluate(() => document.body.classList.contains('drawer-open'))), 'Back closes the sidebar');

  await page.click('.modeswitch [data-mode="quote"]'); await page.waitForTimeout(4000); await shot('6-week');
  await page.click('.modeswitch [data-mode="bible"]'); await page.waitForTimeout(2500); await shot('7-bible');
  check(await page.isVisible('#cameraBtn'), 'the camera button is showing');
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    const g = c.getContext('2d'); g.fillStyle = '#4a7aa0'; g.fillRect(0, 0, 600, 400); g.fillStyle = '#f0c85a'; g.beginPath(); g.arc(300, 200, 90, 0, 7); g.fill();
    await window.wellwrite.save({ date: '2026-10-18', title: 'Sunrise', html: `<img src="${c.toDataURL('image/jpeg', 0.8)}" alt=""><p>Sunrise.</p>` });
  });
  await page.evaluate(() => location.reload()); await page.waitForTimeout(4000);
  if (await page.isVisible('#unlockForm')) { await page.fill('#unlockPw', 'correct horse 1'); await page.click('#unlockBtn'); await page.waitForSelector('#app:not([hidden])'); }
  await page.click('.modeswitch [data-mode="photos"]'); await page.waitForTimeout(3000); await shot('7b-photos');
  check(await page.evaluate(() => [...document.querySelectorAll('.ph-tile img')].some(i => i.src.startsWith('data:image/jpeg'))), 'the Photos view shows the photo');
  const s = await page.evaluate(() => window.wellwrite.bibleSearch('web', 'be still', 0));
  check(s.results.length > 0, 'Bible search works (' + s.total + ' results)');

  await page.evaluate(() => window.wellwrite.setTrust('trust'));
  check((await page.evaluate(() => window.wellwrite.status())).trust.mode === 'trust', 'remember-my-password can be switched on');

  const exp = await page.evaluate(() => window.wellwrite.version());
  check(exp.platform === 'android', 'version ' + exp.version);

  await page.click('#menuBtn'); await page.waitForTimeout(500);
  await page.click('#settingsBtn'); await page.waitForTimeout(1200); await shot('8-settings');

  // The camera: the button opens the phone's camera app, and the photo comes back into today's entry.
  await page.click('#menuBtn').catch(() => {}); await device.shell('input keyevent 4'); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('.modeswitch [data-mode="journal"]').click());
  const before = await page.evaluate(() => window.wellwrite.list().then(l => l.reduce((a, m) => a + m.images, 0)));
  await page.click('#cameraBtn');
  await page.waitForTimeout(6000);
  const focus = String(await device.shell('dumpsys window | grep -E "mCurrentFocus|mFocusedApp" | head -2'));
  log('focus:', focus.replace(/\s+/g, ' ').slice(0, 300));
  check(!/com\.chrisgribble\.wellwrite\/.MainActivity/.test(focus.split('\n')[0]), 'the camera button opens the camera');
  await shot('10-camera');
  // Take the picture and accept it (the emulator's camera app): shutter, then the tick.
  const tapId = async re => {
    const xml = String(await device.shell('uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml'));
    const nodes = [...xml.matchAll(/<node [^>]*>/g)].map(m => m[0]);
    const n = nodes.find(x => re.test(x));
    if (!n) { log('no button matching', re, '; ids:', [...new Set(nodes.map(x => (x.match(/resource-id="([^"]+)"/) || [])[1]).filter(Boolean))].join(' ').slice(0, 600)); return false; }
    const [, x1, y1, x2, y2] = n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).map(Number);
    await device.shell(`input tap ${(x1 + x2) >> 1} ${(y1 + y2) >> 1}`);
    return true;
  };
  for (let i = 0; i < 3 && await tapId(/(Next|Got it|Allow|While using|Only this time|NEXT|ALLOW)/i); i++) await page.waitForTimeout(1500);
  if (!(await tapId(/shutter_button|resource-id="[^"]*shutter[^"]*"|content-desc="Shutter"/i))) await device.shell('input keyevent 27');
  await page.waitForTimeout(4000); await shot('11-taken');
  await tapId(/done_button|content-desc="Done"|resource-id="[^"]*(done|ok|confirm)[^"]*"/i);
  await page.waitForTimeout(6000); await shot('12-back');
  const after = await page.evaluate(() => window.wellwrite.list().then(l => l.reduce((a, m) => a + m.images, 0))).catch(() => -1);
  const inEntry = await page.evaluate(() => document.querySelectorAll('#body img').length).catch(() => -1);
  log('photos before', before, 'after', after, 'in open entry', inEntry);
  check(inEntry > 0, 'a photo from the camera lands in today’s entry');

  log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await device.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { log('ERROR', e.stack || e.message); process.exit(2); });
