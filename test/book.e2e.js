'use strict';
// The Book section (Windows): switched on in Settings, plan chapters, write beside John, progress and saving.
// Run: xvfb-run -a npx electron --no-sandbox test/book.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-book-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-book-shots'));
fs.mkdirSync(OUT, { recursive: true });
const { app, dialog } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1400, 900);
  win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  await wait(400);
  const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 160)); });
  const shot = async n => { await wait(400); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
  const text = sel => js(`const n = document.querySelector('${sel}'); return n ? n.innerText : null`);
  const until = async (cond, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await js(`return !!(${cond})`)) return true; await wait(100); } return false; };
  const click = (sel, label) => js(`for (let t = 0; t < 60; t++) { const b = [...document.querySelectorAll('${sel}')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (b) { b.click(); return; } await new Promise(r => setTimeout(r, 50)); } throw new Error('no button ${label}');`);

  await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
  await wait(2500);

  // Off by default: no Book tab, and Ctrl+5 does nothing
  assert.ok(await js(`return document.querySelector('.modeswitch [data-mode=book]').hidden`), 'no Book tab until it is switched on');
  await js(`setMode('book');`);
  assert.equal(await js(`return state.mode`), 'journal', 'the book stays closed while switched off');

  // Switched on in Settings → General
  await js(`openSettings('general');`); await wait(400);
  assert.match(await text('#dlg'), /Write a book/);
  await js(`const r = [...document.querySelectorAll('#dlg .row')].find(r => /Write a book/.test(r.innerText)); r.querySelector('input[type=checkbox]').click();`);
  await wait(400);
  await click('#dlg button', 'Done'); await wait(400);
  assert.ok(!(await js(`return document.querySelector('#dlg').open`)), 'Settings closed');
  assert.ok(await js(`return !document.querySelector('.modeswitch [data-mode=book]').hidden`), 'the Book tab appears');
  await js(`document.querySelector('.modeswitch [data-mode=book]').click();`);
  assert.ok(await until(`document.querySelector('.bk-title')`));
  assert.equal(await text('.bk-title'), 'My book on John');
  assert.match(await text('.bk-progress'), /0\s*of 50,000 words/);
  const due = await js(`return (await api.bookGet()).info.due`);
  const six = new Date(); six.setMonth(six.getMonth() + 6);
  assert.equal(due.slice(0, 7), six.toISOString().slice(0, 7), 'the draft is due in six months');
  await shot('k1-empty');

  // Book details
  await click('.bk-actions button', 'Book details');
  await js(`const f = document.querySelectorAll('.bk-form input'); f[0].value = 'The Word among us'; f[1].value = 'Reflections on the Gospel of John';`);
  await click('.bk-form-actions button', 'Save');
  assert.ok(await until(`document.querySelector('.bk-title').textContent === 'The Word among us'`));

  // Plan three chapters
  const plan = [['In the beginning', 'John 1:1-18', 'The Word before all things.\nLight in the darkness.\nWhat it means that the Word became flesh.'],
    ['Come and see', 'John 1:35-51', 'The first disciples. Andrew, Peter, Philip and Nathanael.'],
    ['Water into wine', 'John 2:1-11', 'The first sign at Cana.']];
  for (const [t, p, o] of plan) {
    await click('.bk-actions button', '+ New chapter');
    await js(`const f = document.querySelector('.bk-form'); f.querySelector('#bkNewTitle').value = ${JSON.stringify(t)}; f.querySelectorAll('input')[1].value = ${JSON.stringify(p)}; f.querySelector('textarea').value = ${JSON.stringify(o)};`);
    await click('.bk-form-actions button', 'Add to the plan');
    await wait(250);
  }
  assert.deepEqual(await js(`return [...document.querySelectorAll('.bk-ch-title')].map(n => n.textContent)`), plan.map(p => p[0]));
  // Reorder: Water into wine up one
  await js(`[...document.querySelectorAll('.bk-ch')][2].querySelector('[title="Move up"]').click();`); await wait(300);
  assert.deepEqual(await js(`return [...document.querySelectorAll('.bk-ch-title')].map(n => n.textContent)`), ['In the beginning', 'Water into wine', 'Come and see']);
  await js(`[...document.querySelectorAll('.bk-ch')][1].querySelector('[title="Move down"]').click();`); await wait(300);
  await shot('k2-plan');

  // Write: John beside the page
  await js(`document.querySelector('.bk-ch').click();`);
  assert.ok(await until(`document.querySelector('#bkEditor') && document.querySelector('.bk-passage .bk-on')`, 8000), 'the chapter opens with its passage marked');
  assert.match(await text('.bk-passage'), /In the beginning was the Word/);
  assert.equal(await js(`return document.querySelectorAll('.bk-passage .bk-on').length`), 18, 'John 1:1-18 marked');
  const words = 'The Gospel of John begins before the beginning. Before Bethlehem and before the river Jordan there was the Word, and the Word was with God. ';
  await js(`const e = document.querySelector('#bkEditor'); e.focus(); document.execCommand('insertText', false, ${JSON.stringify(words.repeat(4).trim())});`);
  assert.ok(await until(`document.querySelector('#bkSaved').textContent === 'Saved'`, 5000), 'saved as you type');
  const saved = await js(`return await api.bookGet()`);
  assert.equal(saved.stats.words, 100, '25 words, four times');
  assert.match(await text('#bkWords'), /^100 words/);
  assert.match(await text('#bkProgress'), /100 of 50,000/);
  // Another passage in the pane, and back
  await js(`const i = document.querySelector('.bk-ref'); i.value = 'John 3:16'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));`);
  assert.ok(await until(`/God so loved the world/.test(document.querySelector('.bk-passage').innerText)`, 5000));
  await click('.bk-plinks button', 'Back to John 1:1-18');
  assert.ok(await until(`document.querySelectorAll('.bk-passage .bk-on').length === 18`, 5000));
  await js(`document.querySelector('.bk-ch-status').value = 'drafting'; document.querySelector('.bk-ch-status').dispatchEvent(new Event('change'));`);
  await shot('k3-writing');

  // Leaving saves; the overview shows the words and the status
  await js(`document.querySelector('#bkEditor').focus(); document.execCommand('insertText', false, ' One more sentence before I go.');`);
  await click('.bk-deskbar button', '‹ All chapters');
  assert.ok(await until(`document.querySelector('.bk-list')`));
  assert.match(await text('.bk-progress'), /106\s*of 50,000 words/, 'leaving saved the last words straight away');
  assert.match(await text('.bk-ch'), /Drafting/);
  assert.match(await text('.bk-stats'), /106\s*today/);
  await shot('k4-progress');

  // Locking mid-sentence keeps what was typed
  await js(`document.querySelector('.bk-ch').click();`);
  assert.ok(await until(`document.querySelector('#bkEditor')`));
  await js(`const e = document.querySelector('#bkEditor'); e.focus(); const r = document.createRange(); r.selectNodeContents(e); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); document.execCommand('insertText', false, ' Locked just after this.');`);
  await js(`await lockNow();`); await wait(600);
  await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`); await wait(2500);
  assert.equal((await js(`return await api.bookGet()`)).stats.words, 110, 'locking saved the last words');

  // Export to Word
  const file = path.join(os.tmpdir(), `wellwrite-book-${Date.now()}.docx`);
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  await js(`setMode('book');`); await wait(400);
  await click('.bk-actions button', 'Export to Word');
  for (let t = 0; t < 40 && !fs.existsSync(file); t++) await wait(100);
  assert.ok(fs.existsSync(file) && fs.readFileSync(file).slice(0, 2).toString() === 'PK', 'a Word document');
  fs.rmSync(file, { force: true });

  // Switched off: the tab goes, the book stays
  await js(`await updateSetting({ bookOn: false });`); await wait(300);
  assert.equal(await js(`return state.mode`), 'journal');
  assert.ok(await js(`return document.querySelector('.modeswitch [data-mode=book]').hidden`));
  assert.equal((await js(`return await api.bookGet()`)).chapters.length, 3, 'the book is kept');

  assert.deepEqual(errors.filter(e => !/Autofill|DevTools/.test(e)), [], 'no console errors');
  console.log('book e2e passed; shots in', OUT);
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
