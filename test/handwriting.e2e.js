'use strict';
// Handwriting: write a page with a pen, keep it in the entry (picture + strokes, encrypted with the rest),
// open it again to add to it, and delete it. Also: blank lines between paragraphs are drawn short.
// Run: xvfb-run -a npx electron --no-sandbox test/handwriting.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-ink-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-ink-shots'));
fs.mkdirSync(OUT, { recursive: true });

const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
const { getWindow } = require('../main.js');

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 900);
  win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 160)); });
  const shot = async n => { await wait(400); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const has = sel => js(`return !!document.querySelector('${sel}')`);
  // a pen stroke on the pad: a wavy line from (x0,y) across, in screen pixels relative to the canvas
  const write = (x0, y, len, type = 'pen', id = 7) => js(`
    const c = document.querySelector('.ink-canvas'), r = c.getBoundingClientRect();
    const ev = (t, x, yy, extra = {}) => c.dispatchEvent(new PointerEvent(t, { pointerId: ${id}, pointerType: '${type}', isPrimary: true, bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + yy, pressure: 0.6, buttons: t === 'pointerup' ? 0 : 1, ...extra }));
    ev('pointerdown', ${x0}, ${y});
    for (let i = 1; i <= 30; i++) ev('pointermove', ${x0} + i * ${len} / 30, ${y} + Math.sin(i / 3) * 8, { pressure: 0.3 + i / 60 });
    ev('pointerup', ${x0} + ${len}, ${y});`);

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);
  await js(`document.querySelector('#newBtn').click()`); await wait(500);

  // ---- paragraph spacing: a blank line between paragraphs is short; the one you're on is full height ----
  await js(`body.focus(); body.innerHTML = '<p>First paragraph of the entry, long enough to look like writing.</p><p><br></p><p>Second paragraph.</p>'; markDirty();
    const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.setStart(body.lastChild.firstChild, 3); r.collapse(true); s.addRange(r);`);
  await wait(200);
  const gap = await js(`const [a, , b] = body.children; return b.getBoundingClientRect().top - a.getBoundingClientRect().bottom;`);
  const line = await js(`return parseFloat(getComputedStyle(body).lineHeight)`);
  assert.ok(gap < line, `blank line drawn short (${gap.toFixed(1)}px gap, line ${line}px)`);
  await js(`const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.setStart(body.children[1], 0); r.collapse(true); s.addRange(r);`);
  await wait(200);
  assert.ok(await js(`return body.children[1].classList.contains('caret-here') && body.children[1].getBoundingClientRect().height >= ${line} - 1`), 'the blank line with the cursor is full height');
  await shot('h0-paragraphs');

  // ---- write a page ----
  await js(`const s = getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); s.addRange(r);
    document.querySelector('#toolbar [data-k=pen]').click();`);
  await wait(300);
  assert.ok(await has('.ink-pad .ink-canvas'), 'pad opens');
  for (let i = 0; i < 4; i++) await write(90, 100 + i * 52, 380 + i * 40);
  await write(500, 300, 0);                                   // a dot
  assert.equal(await js(`return document.querySelectorAll('.ink-btn')[2].disabled`), false, 'undo available');
  await write(100, 40, 200, 'touch', 9);                      // a palm/finger after the pen: scrolls, doesn't write
  await shot('h1-pad');
  await js(`[...document.querySelectorAll('.ink-pad .btn-ink')].find(b => b.textContent === 'Done').click()`);
  await wait(600);
  assert.ok(!(await has('.ink-pad')), 'pad closes');
  assert.ok(await has('#body img[data-ink]'), 'handwritten page in the entry');
  const ink1 = await js(`return document.querySelector('#body img[data-ink]').getAttribute('data-ink')`);
  const page1 = await js(`return WellWriteInk.decode(${JSON.stringify(ink1)})`);
  assert.equal(page1.strokes.length, 5, 'five strokes kept (the finger made none)');
  assert.ok(page1.strokes[0].pts.length > 20 && page1.strokes[0].pts.every(p => p.p > 0 && p.t > 0), 'points keep pressure and time');
  await js(`await saveNow()`); await wait(400);
  await shot('h2-entry');

  // saved, encrypted, and not counted as a photo
  const id = await js(`return state.current.id`);
  const saved = await js(`return (await api.get('${id}')).html`);
  assert.match(saved, /data-ink="v1:/, 'strokes saved with the entry');
  const meta = await js(`return state.metas.find(m => m.id === '${id}')`);
  assert.equal(meta.images, 0, 'not counted as a photo'); assert.equal(meta.ink, 1, 'counted as handwriting');
  const files = fs.readdirSync(process.env.WELLWRITE_DATA_DIR, { recursive: true }).map(f => path.join(process.env.WELLWRITE_DATA_DIR, f)).filter(f => fs.statSync(f).isFile());
  assert.ok(!files.some(f => fs.readFileSync(f).includes('data-ink')), 'nothing readable on disk');
  assert.ok(!(await js(`return clean(body.innerHTML)`)).includes('caret-here'), 'the cursor marker is never saved');

  // ---- open it again (as a tap would on a tablet), add a line and undo/redo, then Done ----
  await js(`body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); document.querySelector('#body img[data-ink]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));`);
  await wait(500);
  assert.ok(await has('.ink-pad'), 'pad reopens with the page');
  await write(90, 320, 300);
  await js(`document.querySelectorAll('.ink-btn')[2].click(); document.querySelectorAll('.ink-btn')[3].click();`);   // undo, redo
  await js(`[...document.querySelectorAll('.ink-pad .btn-ink')].find(b => b.textContent === 'Done').click()`); await wait(600);
  const page2 = await js(`return WellWriteInk.decode(document.querySelector('#body img[data-ink]').getAttribute('data-ink'))`);
  assert.equal(page2.strokes.length, 6, 'added line kept');
  assert.equal(page2.at, page1.at, 'when writing began is kept');

  // ---- eraser removes whole strokes ----
  await js(`document.querySelector('#body img[data-ink]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await wait(500);
  await js(`document.querySelectorAll('.ink-btn')[1].click()`);   // eraser
  await write(500, 300, 0, 'pen', 11);
  await js(`[...document.querySelectorAll('.ink-pad .btn-ink')].find(b => b.textContent === 'Done').click()`); await wait(600);
  const page3 = await js(`return WellWriteInk.decode(document.querySelector('#body img[data-ink]').getAttribute('data-ink'))`);
  assert.equal(page3.strokes.length, 5, 'eraser removed the dot');

  // ---- photos view ignores handwriting ----
  await js(`document.querySelector('.modeswitch [data-mode=photos]').click()`); await wait(600);
  assert.ok(!(await has('#photosView .ph-tile img[src]')), 'no handwriting in Photos');
  await js(`document.querySelector('.modeswitch [data-mode=journal]').click()`); await wait(600);
  await js(`await openEntry('${id}')`); await wait(500);

  // ---- delete the page ----
  await js(`document.querySelector('#body img[data-ink]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await wait(500);
  await js(`[...document.querySelectorAll('.ink-pad .ink-text')].find(b => b.textContent === 'Delete page').click()`); await wait(500);
  assert.ok(!(await has('#body img[data-ink]')), 'page deleted');

  // ---- forged data-ink is stripped ----
  assert.ok(!(await js(`return clean('<p data-ink="v1:abc">x</p><img src="data:image/png;base64,AAAA" data-ink="<script>">')`)).includes('data-ink'));

  assert.deepEqual(errors, [], 'no console errors');
  console.log('handwriting e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
