'use strict';
// Categories, [[links]] between entries, backlinks, related-by-tag, back navigation.
// Run: xvfb-run -a npx electron --no-sandbox test/connections.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-conn-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-conn-shots'));
fs.mkdirSync(OUT, { recursive: true });
const { app } = require('electron');
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 820);
  win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`);
  const shot = async n => { await wait(350); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const key = async k => { win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(120); };

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);
  const ids = await js(`
    const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    const E = [
      { date: day(0), time: '07:40', title: 'Planning the garden', tags: ['garden', 'spring'], html: '<p>Raised beds along the fence.</p>' },
      { date: day(2), time: '18:10', title: 'Seed order from Diggers', tags: ['garden'], html: '<p>Tomatoes, basil, snow peas.</p>' },
      { date: day(5), time: '09:00', title: 'Talk with Sam about the move', tags: ['family'], html: '<p>Sam is keen on Ballarat.</p>' },
      { date: day(9), time: '21:00', title: 'Compost bin notes', tags: ['garden', 'diy'], html: '<p>Two bays, turn weekly.</p>' },
    ];
    const out = [];
    for (const e of E) { const d = document.createElement('div'); d.innerHTML = e.html; out.push((await window.wellwrite.save({ ...e, text: d.textContent })).id); }
    document.querySelector('#lockBtn').click();
    return out;`);
  await wait(600);
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`);
  await wait(2500);
  const [garden, seeds, sam, compost] = ids;

  // --- category: pick a suggestion on the first entry
  await js(`document.querySelector('#catPill').click();`); await wait(300);
  await shot('c1-category-menu');
  await js(`[...document.querySelectorAll('.menu-suggest .btn-link')].find(b => b.textContent === 'Personal').click();`);
  await wait(1200);
  let m = await js(`return (await window.wellwrite.list()).find(m => m.id === '${garden}')`);
  const cats = await js(`return await window.wellwrite.getCategories()`);
  assert.equal(cats.length, 1); assert.equal(cats[0].name, 'Personal');
  assert.equal(m.category, cats[0].id, 'entry saved with category');
  assert.equal(await js(`return document.querySelector('#catPill').textContent`), 'Personal');

  // add a second category from the menu's text box, to the Sam entry
  await js(`document.querySelector('.item[data-id="${sam}"]').click();`); await wait(500);
  await js(`document.querySelector('#catPill').click();`); await wait(250);
  await js(`const i = document.querySelector('#popover .pop-search'); i.value = 'Family'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(1200);
  assert.equal((await js(`return await window.wellwrite.getCategories()`)).length, 2);

  // --- [[ link from the garden entry to the seed order
  await js(`document.querySelector('.item[data-id="${garden}"]').click();`); await wait(500);
  win.webContents.focus();
  await js(`const b = document.querySelector('#body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  await win.webContents.insertText(' See ');
  await win.webContents.insertText('[');
  await win.webContents.insertText('[');
  await wait(300);
  assert(await js(`return !document.querySelector('#popover').hidden`), '[[ opens the picker');
  await js(`const i = document.querySelector('#popover .pop-search'); i.value = 'seed'; i.dispatchEvent(new Event('input'));`);
  await wait(200);
  await shot('c2-link-picker');
  await js(`document.querySelector('#popover .pop-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(1500);
  m = await js(`return (await window.wellwrite.list()).find(m => m.id === '${garden}')`);
  assert.deepEqual(m.links, [seeds], 'link stored');
  assert(!(await js(`return document.querySelector('#body').innerText`)).includes('[['), 'brackets removed');

  // create-and-link a brand new entry from the picker
  await js(`const b = document.querySelector('#body'); b.focus(); const r = document.createRange(); r.selectNodeContents(b); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);`);
  await win.webContents.insertText(' and [[');
  await wait(300);
  await js(`const i = document.querySelector('#popover .pop-search'); i.value = 'Fence repairs'; i.dispatchEvent(new Event('input'));`);
  await wait(150);
  await js(`document.querySelector('#popover .pop-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(1500);
  m = await js(`return (await window.wellwrite.list()).find(m => m.id === '${garden}')`);
  assert.equal(m.links.length, 2);
  const fence = await js(`return (await window.wellwrite.list()).find(m => m.title === 'Fence repairs')`);
  assert(fence && m.links.includes(fence.id), 'new entry created and linked');
  assert.equal(fence.category, cats[0].id, 'new entry takes the category of the one it came from');
  await shot('c3-entry-with-links');

  // connections panel: shares tags with compost (seed order is linked, so not repeated)
  const conn = await js(`return document.querySelector('#connections').innerText`);
  assert.match(conn, /Links to/); assert.match(conn, /Shares tags with[\s\S]*Compost bin notes/);
  assert(!/Shares tags with[\s\S]*Seed order/.test(conn), 'linked entries not repeated as related');

  // --- follow the link, see the backlink, go back
  await js(`[...document.querySelectorAll('#body a.xref')].find(a => a.textContent.includes('Seed order')).click();`);
  await wait(700);
  assert.equal(await js(`return document.querySelector('#title').value`), 'Seed order from Diggers');
  assert.match(await js(`return document.querySelector('#connections').innerText`), /Linked from 1 entry[\s\S]*Planning the garden/);
  assert.match(await js(`return document.querySelector('#backLink').textContent`), /Back to Planning the garden/);
  await shot('c4-backlinks');
  await js(`document.querySelector('#backLink').click();`); await wait(600);
  assert.equal(await js(`return document.querySelector('#title').value`), 'Planning the garden');
  assert(await js(`return document.querySelector('#backLink').hidden`));

  // rename the target: the link chip shows the new title
  await js(`await window.wellwrite.save({ ...(await window.wellwrite.get('${seeds}')), title: 'Seed order (Diggers, spring)' });`);
  await js(`document.querySelector('.item[data-id="${sam}"]').click();`); await wait(400);
  await js(`state.metas = await window.wellwrite.list(); document.querySelector('.item[data-id="${garden}"]').click();`); await wait(600);
  assert(await js(`return [...document.querySelectorAll('#body a.xref')].some(a => a.textContent === 'Seed order (Diggers, spring)')`), 'chip follows renames');

  // --- sidebar category filter
  await js(`[...document.querySelectorAll('.cat-chip')].find(b => b.textContent === 'Family').click();`); await wait(300);
  assert.deepEqual(await js(`return [...document.querySelectorAll('#list .item')].map(i => i.dataset.id)`), [sam]);
  await shot('c5-category-filter');
  await js(`document.querySelector('.cat-chip.on').click();`); await wait(200);

  // --- survives lock/unlock (sanitiser keeps entry links)
  await js(`document.querySelector('#lockBtn').click();`); await wait(600);
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`);
  await wait(2500);
  await js(`document.querySelector('.item[data-id="${garden}"]').click();`); await wait(500);
  assert.equal(await js(`return document.querySelectorAll('#body a.xref').length`), 2);

  // --- delete the linked-to entry: chip shows as broken
  await js(`await window.wellwrite.remove('${fence.id}'); state.metas = await window.wellwrite.list(); decorateLinks();`);
  assert.equal(await js(`return document.querySelectorAll('#body a.xref.broken').length`), 1);

  // --- categories dialog: delete Personal (two-step), entries keep existing
  await js(`manageCategories();`); await wait(300);
  await shot('c6-categories-dialog');
  await js(`[...document.querySelectorAll('.cat-row')].find(r => r.querySelector('input').value === 'Personal').querySelector('.danger').click();`); await wait(100);
  await js(`[...document.querySelectorAll('.cat-row')].find(r => r.querySelector('input').value === 'Personal').querySelector('.danger').click();`); await wait(1200);
  assert.deepEqual((await js(`return await window.wellwrite.getCategories()`)).map(c => c.name), ['Family']);
  m = await js(`return (await window.wellwrite.list()).find(m => m.id === '${garden}')`);
  assert.equal(m.category, ''); assert.equal(m.title, 'Planning the garden');
  await js(`document.querySelector('#dlg').close();`);

  assert.deepEqual(errors, [], 'no console errors');
  console.log('connections e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
