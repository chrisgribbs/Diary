'use strict';
// Checks every screen of the Android version at phone sizes: screenshots each one and looks for text that overlaps
// other text, text or buttons that run off the screen, and text cut off without an ellipsis.
// Needs the dev server (node android/dev/server.js 5173 <fresh dir>) and Playwright.
//   node android/dev/audit.js <outDir> [widths, e.g. 360,393,412] [--dark]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'audit';
const WIDTHS = (process.argv[3] || '360,393,412').split(',').map(Number);
const DARK = process.argv.includes('--dark');
// Android's "Font size" setting makes the WebView scale every text size (textZoom); --zoom=1.3 imitates it.
const ZOOM = +((process.argv.find(a => a.startsWith('--zoom=')) || '').split('=')[1] || 1);
const URL = process.env.AUDIT_URL || 'http://localhost:5173/';
const PW = 'audit-pass-1';
fs.mkdirSync(OUT, { recursive: true });

/** Runs in the page: problems on the screen as it is now. */
function audit() {
  const W = innerWidth, H = innerHeight;
  const problems = [];
  const layerOf = el => el.closest('dialog[open], #popover, #lightbox, #toast, .cloth, .lock, .page, .scrim') || document.body;
  const label = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    return s;
  };
  const visible = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  // The part of a box that its scrolling/clipping ancestors actually show.
  const clipRect = (el, r) => {
    let { left, top, right, bottom } = r;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contain.includes('paint')) {
        const b = a.getBoundingClientRect();
        if (s.overflowX !== 'visible') { left = Math.max(left, b.left); right = Math.min(right, b.right); }
        if (s.overflowY !== 'visible') { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
      }
      if (s.position === 'fixed') break;
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  const scrollsX = el => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) return true;
    }
    return false;
  };

  // Every line of visible text.
  const lines = [];
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.nodeValue.trim() ? 1 : 2) });
  for (let n; (n = tw.nextNode());) {
    const el = n.parentElement;
    if (!el || !visible(el) || el.closest('script,style,datalist,option,[aria-hidden="true"]')) continue;
    if (el.closest('.visually-hidden')) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2) continue;
      const c = clipRect(el, r);
      if (c.width < 1 || c.height < 1) continue;              // scrolled or clipped out of view
      if (c.bottom < 0 || c.top > H) continue;
      lines.push({ el, node: n, r: c, text: n.nodeValue.trim().slice(0, 50), layer: layerOf(el) });
    }
  }
  // Text over other text (in the same layer: a dialog covering the page is fine).
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (a.node === b.node || a.layer !== b.layer) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w > 3 && h > Math.min(a.r.height, b.r.height) * 0.3) {
        // Only if both can actually be seen there.
        const x = (Math.max(a.r.left, b.r.left) + Math.min(a.r.right, b.r.right)) / 2, y = (Math.max(a.r.top, b.r.top) + Math.min(a.r.bottom, b.r.bottom)) / 2;
        const stack = document.elementsFromPoint(x, y);
        const ia = stack.findIndex(e => e === a.el || a.el.contains(e)), ib = stack.findIndex(e => e === b.el || b.el.contains(e));
        if (ia < 0 && ib < 0) continue;
        // Something opaque above the lower one hides it.
        const lower = (ia < 0 ? 1e9 : ia) > (ib < 0 ? 1e9 : ib) ? a.el : b.el;
        const li = lower === a.el ? (ia < 0 ? stack.length : ia) : (ib < 0 ? stack.length : ib);
        let covered = false;
        for (let k = 0; k < li; k++) {
          const bg = getComputedStyle(stack[k]).backgroundColor;
          if (bg && !/rgba\(.*, 0\)$|transparent/.test(bg) && !stack[k].contains(lower)) { covered = true; break; }
        }
        if (covered) continue;
        problems.push({ type: 'overlap', a: `${label(a.el)} “${a.text}”`, b: `${label(b.el)} “${b.text}”`, at: [Math.round(x), Math.round(y)] });
      }
    }
  }
  // Off the side of the screen (not inside something that scrolls sideways on purpose).
  for (const l of lines) {
    if ((l.r.right > W + 1 || l.r.left < -1) && !scrollsX(l.el) && !l.el.closest('.cloth:not(.open)') && !(document.body.classList.contains('drawer-open') === false && l.layer.matches && l.layer.matches('.cloth')))
      problems.push({ type: 'off-screen text', a: `${label(l.el)} “${l.text}”`, at: [Math.round(l.r.left), Math.round(l.r.right)] });
  }
  for (const el of document.querySelectorAll('button, input, select, textarea, a')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.bottom < 0 || r.top > H) continue;
    if (layerOf(el).matches && layerOf(el).matches('.cloth') && !document.body.classList.contains('drawer-open')) continue;
    if ((r.right > W + 1 || r.left < -1) && !scrollsX(el)) problems.push({ type: 'off-screen control', a: label(el) + ' “' + (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 40) + '”', at: [Math.round(r.left), Math.round(r.right)] });
  }
  // Text cut off without an ellipsis.
  const seen = new Set();
  for (const l of lines) {
    for (let a = l.el; a && a !== document.body; a = a.parentElement) {
      if (seen.has(a)) break;
      const s = getComputedStyle(a);
      if (s.overflowX === 'hidden' || s.overflowX === 'clip') {
        seen.add(a);
        if (a.scrollWidth > a.clientWidth + 2 && s.textOverflow !== 'ellipsis' && !a.matches('.ph-tile, .toolbar') && s.whiteSpace !== 'normal')
          problems.push({ type: 'cut off', a: label(a) + ' “' + a.textContent.trim().slice(0, 40) + '”' });
        break;
      }
    }
  }
  if (document.scrollingElement.scrollWidth > W + 1) problems.push({ type: 'page scrolls sideways', a: `${document.scrollingElement.scrollWidth}px wide` });
  // Small tap targets on the phone (buttons with text are allowed down to 30px tall).
  for (const el of document.querySelectorAll('button, [role=tab], select, input[type=checkbox]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.bottom < 0 || r.top > H || layerOf(el).matches?.('.cloth') && !document.body.classList.contains('drawer-open')) continue;
    if (Math.max(r.width, r.height) < 24 && Math.min(r.width, r.height) < 20) problems.push({ type: 'tiny tap target', a: label(el) + ' “' + (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '”', at: [Math.round(r.width), Math.round(r.height)] });
  }
  return problems;
}

(async () => {
  const browser = await chromium.launch();
  const report = {};
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: Math.round(width * 2.1) }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: DARK ? 'dark' : 'light' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const shots = [];
    const tag = `${width}${DARK ? 'd' : ''}${ZOOM !== 1 ? 'z' : ''}`;
    const shot = async (name, opts = {}) => {
      await page.waitForTimeout(opts.wait ?? 500);
      if (ZOOM !== 1) await page.evaluate(z => {
        const els = [...document.querySelectorAll('body, body *')];
        const sizes = els.map(e => parseFloat(getComputedStyle(e).fontSize));
        els.forEach((e, i) => { e.dataset.zoomWas = e.style.fontSize || '-'; e.style.fontSize = (sizes[i] * z) + 'px'; });
      }, ZOOM);
      const file = path.join(OUT, `${tag}-${String(shots.length + 1).padStart(2, '0')}-${name}.png`);
      await page.screenshot({ path: file, fullPage: false });
      const problems = await page.evaluate(audit);
      if (ZOOM !== 1) await page.evaluate(() => document.querySelectorAll('[data-zoom-was]').forEach(e => { e.style.fontSize = e.dataset.zoomWas === '-' ? '' : e.dataset.zoomWas; delete e.dataset.zoomWas; }));
      shots.push({ name, file, problems });
      if (problems.length) console.log(`[${tag}] ${name}: ${problems.length} problem(s)`);
    };
    const step = async (name, fn) => { try { await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 25000))]); } catch (e) { console.log(`[${tag}] ${name} FAILED: ${e.message.split('\n')[0]}`); shots.push({ name, failed: e.message.split('\n')[0] }); } };
    const call = (fn, ...args) => page.evaluate(([fn, args]) => window[fn](...args), [fn, args]);
    const closeAll = () => page.evaluate(() => {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
      if (typeof closePopover === 'function') closePopover();
      document.body.classList.remove('drawer-open');
      const lb = document.querySelector('#lightbox'); if (lb) lb.hidden = true;
    });

    await page.goto(URL);
    await page.waitForTimeout(1500);
    const fresh = await page.isVisible('#setupForm');
    await step('lock-setup', async () => { if (fresh) await shot('lock-setup'); });
    if (fresh) { await page.fill('#setupPw', PW); await page.fill('#setupPw2', PW); await page.click('#setupBtn'); }
    else { await page.fill('#unlockPw', PW); await page.click('#unlockBtn'); }
    await page.waitForSelector('#app:not([hidden])', { timeout: 20000 });
    await page.waitForTimeout(2500);

    // Some writing to look at (once).
    await page.evaluate(async () => {
      const api = window.wellwrite;
      if ((await api.list()).length) return;
      await api.setCategories([
        { id: 'c1', name: 'Ministry and community reflections', color: '#b5473a' },
        { id: 'c2', name: 'Family', color: '#3f7d5c', parent: 'c1' },
        { id: 'c3', name: 'Prayer', color: '#4a6fa5' }]);
      const img = (w, h, a, b) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = a; g.fillRect(0, 0, w, h); g.fillStyle = b; g.fillRect(w * .2, h * .2, w * .6, h * .6); return c.toDataURL('image/jpeg', .8); };
      const today = new Date(); const iso = d => new Date(today - d * 864e5).toISOString().slice(0, 10);
      const a = await api.save({ date: iso(0), time: '07:15', category: 'c1', tags: ['gratitude', 'kathmandu-memories', 'long-tag-name-for-testing-wrapping', 'walk'],
        title: 'A very long title about the morning walk along the river, and what the light said about patience, waiting and grace',
        html: `<p>The light came slowly over the water. I noticed how quiet I felt, and grateful. Supercalifragilisticexpialidociousandmoreunbrokenwordsthatmightoverflowthepage.</p><img src="${img(1600, 1000, '#4a7aa0', '#f0c85a')}" alt=""><h2>What I noticed</h2><ul><li>The heron</li><li>The bells from the church across the river, which rang longer than usual</li></ul><blockquote>Be still, and know.</blockquote><p>A link to <a href="https://example.com/a/very/long/url/that/should/wrap/properly/on/a/phone/screen">https://example.com/a/very/long/url/that/should/wrap/properly/on/a/phone/screen</a></p>` });
      await api.save({ date: iso(0), time: '21:40', category: 'c3', tags: ['prayer'], title: 'Evening prayer', html: '<p>Short and simple.</p>' });
      await api.save({ date: iso(1), category: 'c2', tags: ['family'], title: 'Yesterday', html: `<p>See [[${a.id}|the walk]].</p><img src="${img(800, 1200, '#8a5a3c', '#5c8a50')}" alt="">` });
      for (let i = 2; i < 40; i++) await api.save({ date: iso(i * 3), title: i % 5 ? '' : 'Entry number ' + i + ' with a title that goes on for a while', tags: i % 3 ? ['walk'] : [], html: `<p>Day ${i}. ${'Words of the day. '.repeat(i % 7 + 1)}</p>` });
      location.reload();
    });
    await page.waitForTimeout(2500);
    if (await page.isVisible('#unlockForm')) { await page.fill('#unlockPw', PW); await page.click('#unlockBtn'); await page.waitForSelector('#app:not([hidden])'); await page.waitForTimeout(2500); }

    // ---- the journal
    await step('home', async () => { await page.evaluate(() => setMode('journal')); await page.evaluate(() => { const m = state.metas.find(x => x.title.startsWith('A very long')); return openEntry(m.id); }); await shot('entry-top'); });
    await step('entry-mid', async () => { await page.evaluate(() => { const s = document.querySelector('#sheetScroll'); s.scrollTop = document.querySelector('#title').offsetTop - 20; }); await shot('entry-title'); });
    await step('entry-body', async () => { await page.evaluate(() => { const s = document.querySelector('#sheetScroll'); s.scrollTop = document.querySelector('#body').offsetTop + 200; }); await shot('entry-body'); });
    await step('entry-end', async () => { await page.evaluate(() => { const s = document.querySelector('#sheetScroll'); s.scrollTop = s.scrollHeight; }); await shot('entry-end'); });
    await step('entry-linked', async () => { await page.evaluate(() => { const m = state.metas.find(x => x.title === 'Yesterday'); return openEntry(m.id); }); await shot('entry-linked'); });
    await step('category-menu', async () => { await page.evaluate(() => { const m = state.metas.find(x => x.title.startsWith('A very long')); return openEntry(m.id); }); await page.evaluate(() => { document.querySelector('#sheetScroll').scrollTop = document.querySelector('#title').offsetTop - 20; }); await page.click('#catPill'); await shot('category-menu'); await closeAll(); });
    await step('link-picker', async () => { await page.evaluate(() => { openLinkPicker(); }); await shot('link-picker'); await closeAll(); });
    await step('new-entry', async () => { await page.evaluate(() => newEntry(todayISO())); await shot('new-entry'); });
    await step('empty', async () => { await page.evaluate(() => { state.current = null; showEmpty(); }); await shot('empty-today'); });
    await step('lightbox', async () => { await page.evaluate(() => { const m = state.metas.find(x => x.title.startsWith('A very long')); return openEntry(m.id); }); await page.evaluate(() => document.querySelector('#body img').click()); await shot('lightbox'); await closeAll(); });
    await step('toast', async () => { await page.evaluate(() => toast('Dated 18 October 2026, when the photo was taken')); await shot('toast', { wait: 300 }); await page.evaluate(() => document.querySelector('#toast').classList.remove('show')); });
    await step('delete-confirm', async () => { page.evaluate(() => { confirmDialog({ title: 'Delete this entry?', text: 'It will be gone for good. This cannot be undone, even from a backup made after today.', ok: 'Delete', danger: true }); }); await shot('confirm'); await closeAll(); });

    // ---- the sidebar
    await step('drawer', async () => { await page.click('#menuBtn'); await shot('drawer-calendar'); });
    await step('drawer-update', async () => { await page.evaluate(() => showUpdate('1.20.0')); await page.evaluate(() => { const c = document.querySelector('.cloth'); }); await shot('drawer-update'); await page.evaluate(() => { document.querySelector('#updateBar').hidden = true; }); });
    await step('drawer-cats', async () => { await page.click('.sidetabs [data-view="categories"]'); await shot('drawer-categories'); });
    await step('drawer-tags', async () => { await page.click('.sidetabs [data-view="tags"]'); await shot('drawer-tags'); });
    await step('drawer-search', async () => { await page.click('.sidetabs [data-view="calendar"]'); await page.fill('#search', 'walk'); await page.waitForTimeout(800); await shot('drawer-search'); await page.fill('#search', ''); });
    await step('drawer-scroll', async () => { await page.evaluate(() => { const l = document.querySelector('.cloth'); l.scrollTop = 1e6; const list = document.querySelector('#list'); list.scrollTop = 1e6; }); await shot('drawer-bottom'); });
    await step('all-entries', async () => { await page.evaluate(() => { openAllEntries(); }); await shot('all-entries'); await closeAll(); });

    // ---- week, quotes, writers
    await step('week', async () => { await page.evaluate(() => setMode('quote')); await shot('week-top', { wait: 2500 }); });
    for (const at of [0.2, 0.4, 0.6, 0.8, 1]) await step('week-' + at, async () => { await page.evaluate(f => { const s = document.querySelector('#sheetScroll'); s.scrollTop = (s.scrollHeight - s.clientHeight) * f; }, at); await shot('week-' + Math.round(at * 100)); });
    await step('author', async () => { await page.evaluate(() => setMode('journal')); await page.evaluate(() => { state.current = null; showEmpty(); }); await page.waitForTimeout(800);
      await page.evaluate(() => { const b = document.querySelector('.author-link'); b.scrollIntoView({ block: 'center' }); b.click(); }); await shot('author-popover'); });
    await step('author-page', async () => { await page.evaluate(() => document.querySelector('#authorMore').click()); await shot('author-page'); await page.evaluate(() => { document.querySelector('dialog[open] form').scrollTop = 1e6; document.querySelector('#dlg').scrollTop = 1e6; }); await shot('author-page-end'); await closeAll(); });
    await step('version-menu', async () => { await page.evaluate(() => { const b = document.querySelector('.version-btn'); b.scrollIntoView({ block: 'center' }); b.click(); }); await shot('version-menu'); await closeAll(); });
    await step('show-above', async () => { await page.evaluate(() => document.querySelector('#showAbove').click()); await shot('show-above-menu'); await closeAll(); });

    // ---- the Bible
    await step('bible', async () => { await page.evaluate(() => { state.bibleTab = 'read'; setMode('bible'); }); await shot('bible-read', { wait: 1500 }); });
    await step('bible-scroll', async () => { await page.evaluate(() => { const s = document.querySelector('#sheetScroll'); s.scrollTop = 900; }); await shot('bible-read-scrolled'); });
    await step('book-picker', async () => { await page.evaluate(() => document.querySelector('#sheetScroll').scrollTop = 0); const b = await page.$('.rd-book, .rd-title, [class*="rd-"] button'); const btns = await page.$$('#bibleView button'); for (const x of btns) { const t = (await x.textContent()).trim(); if (/^Psalm|▾$/.test(t) && !/WEB/.test(t)) { await x.click(); break; } } await shot('book-picker'); await closeAll(); });
    await step('bible-search', async () => { await page.evaluate(() => { state.bibleTab = 'search'; renderBibleView(); }); await page.waitForTimeout(500); const i = await page.$('#bibleView input'); await i.fill('peace be with you'); await i.press('Enter'); await shot('bible-search', { wait: 1500 }); });
    await step('bible-plans', async () => { await page.evaluate(() => { state.bibleTab = 'plan'; renderBibleView(); }); await shot('bible-plans', { wait: 1200 }); });
    await step('bible-plan-start', async () => { const b = await page.$('#bibleView .plan-opt'); if (b) { await b.click(); await page.waitForTimeout(300); const go = await page.$('#bibleView .btn-ink'); if (go) await go.click(); } await shot('bible-plan', { wait: 1500 }); });

    // ---- photos
    await step('photos', async () => { await page.evaluate(() => setMode('photos')); await shot('photos', { wait: 2500 }); });

    // ---- settings, every tab
    await step('settings', async () => { await page.evaluate(() => { openSettings(); }); await shot('settings-list'); await page.click('.set-tab[data-tab="general"]'); await shot('settings-general'); });
    for (const t of ['readings', 'bible', 'privacy', 'backups', 'wordpress', 'about']) {
      await step('settings-' + t, async () => { await page.evaluate(() => { const b = document.querySelector('.set-back'); if (b && b.checkVisibility()) b.click(); }); await page.click(`.set-tab[data-tab="${t}"]`); await shot('settings-' + t); await page.evaluate(() => { const c = document.querySelector('.set-content'); if (c) c.scrollTop = 1e6; }); await shot('settings-' + t + '-end'); });
    }
    await step('settings-close', closeAll);
    await step('quotes', async () => { await page.evaluate(() => { manageQuotes(); }); await shot('quotes-manager', { wait: 1200 }); await page.evaluate(() => { const f = document.querySelector('#dlg'); f.scrollTop = 600; document.querySelector('#dlgForm').scrollTop = 600; }); await shot('quotes-manager-scrolled'); });
    await step('quote-edit', async () => { const b = await page.$('#dlg .q-row button'); if (!b) throw new Error('no quote row'); await b.click(); await shot('quote-edit', { wait: 800 }); await closeAll(); });
    await step('categories', async () => { await page.evaluate(() => { manageCategories(); }); await shot('categories-manager'); await closeAll(); });
    await step('password', async () => { await page.evaluate(() => { changePassword(); }); await shot('change-password'); await closeAll(); });
    await step('import-preview', async () => { page.evaluate(() => { importPreview([{ text: 'A long quote that someone pasted from a book, with enough words to wrap over several lines on a phone.', author: 'Henri Nouwen', source: 'The Return of the Prodigal Son' }, { text: 'Short.', author: 'Someone' }], 'My Clippings.txt'); }); await shot('import-preview'); await closeAll(); });
    await step('wordpress-post', async () => {
      await page.evaluate(() => {
        const api = window.wellwrite;
        api.wpStatus = async () => ({ connected: true, site: 'https://www.example-church-community-blog.org', user: 'chris', name: 'Chris Gribble' });
        api.wpRecord = async () => null;
        const m = state.metas.find(x => x.title.startsWith('A very long')); return openEntry(m.id);
      });
      page.evaluate(() => { postToWordPress(); }); await shot('wordpress-post', { wait: 1200 }); await closeAll();
    });
    await step('restore-prompt', async () => { page.evaluate(() => { promptDialog({ title: 'Password for this backup', text: 'Type the password the backup was made with. It may be different from your journal’s password now.', label: 'Backup password', type: 'password', ok: 'Restore' }); }); await shot('prompt'); await closeAll(); });

    // ---- the lock screen, and "remember my password"
    await step('lock', async () => { await page.evaluate(() => lockNow()); await shot('lock-unlock', { wait: 1200 }); });
    await step('lock-wrong', async () => { await page.fill('#unlockPw', 'wrong password'); await page.click('#unlockBtn'); await shot('lock-wrong', { wait: 1500 }); });
    await step('trust', async () => { await page.fill('#unlockPw', PW); await page.click('#unlockBtn'); await page.waitForSelector('#app:not([hidden])'); await page.evaluate(() => window.wellwrite.setTrust('hour')); await page.evaluate(() => lockNow()); await shot('lock-trusted', { wait: 1500 }); await page.evaluate(() => window.wellwrite.setTrust('ask')); });

    report[tag] = { errors, shots };
    console.log(`[${tag}] ${shots.length} screens, ${shots.reduce((a, s) => a + (s.problems ? s.problems.length : 0), 0)} problems, ${shots.filter(s => s.failed).length} steps failed, ${errors.length} page errors`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  await browser.close();
})();
