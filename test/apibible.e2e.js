'use strict';
// API.Bible versions: connect with a key, choose versions, read them everywhere; WEB when offline.
// Run: xvfb-run -a npx electron --no-sandbox test/apibible.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), http = require('http');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-apib-'));
process.env.WELLWRITE_TEST_TRUST = '1';
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-apib-shots'));
fs.mkdirSync(OUT, { recursive: true });

const KEY = 'good-key-123', ID = 'abcd1234ef567890-01';
const hits = [];
const para = (style, text, vid) => ({ name: 'para', type: 'tag', attrs: { style }, items: [{ text, type: 'text', attrs: { verseId: vid } }] });
const server = http.createServer((req, res) => {
  hits.push(req.url);
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith('/fums')) return send(200, {});
  if (req.headers['api-key'] !== KEY) return send(401, { message: 'bad key' });
  if (req.url.startsWith('/bibles?')) return send(200, { data: [
    { id: ID, name: 'Test Standard Version', abbreviationLocal: 'TSV', language: { name: 'English' } },
    { id: 'zzzz9999yyyy8888-01', name: 'Another Test Version', abbreviation: 'ATV', language: { name: 'English' } }] });
  let m = req.url.match(/^\/bibles\/([^/]+)\/passages\/([^?]+)/);
  if (m) { const [b, c, v] = m[2].split('-')[0].split('.'); return send(200, { data: { content: [para('q1', `TSV line one of ${m[2]},`, `${b}.${c}.${v}`), para('q2', 'and line two.', `${b}.${c}.${v}`)], copyright: '<p>Test Standard Version © 2026 Test Society.</p>' }, meta: { fumsToken: 'tok-' + m[2] } }); }
  m = req.url.match(/^\/bibles\/([^/]+)\/chapters\/([^?]+)/);
  if (m) return send(200, { data: { content: [para('s1', 'A heading', `${m[2]}.1`), para('p', `Chapter text of ${m[2]} in TSV.`, `${m[2]}.1`)], copyright: 'Test Standard Version © 2026 Test Society.' }, meta: { fumsToken: 'tokc' } });
  send(404, {});
});

const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
server.listen(0, '127.0.0.1', () => {
  process.env.WELLWRITE_APIBIBLE_URL = `http://127.0.0.1:${server.address().port}`;
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
    const text = sel => js(`const n = document.querySelector('${sel}'); return n ? n.innerText : null`);
    const until = async (cond, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await js(`return !!(${cond})`)) return true; await wait(200); } return false; };

    await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
    await wait(2500);

    // connect: a wrong key is refused, the right one opens the version chooser
    await js(`openSettings('bible');`); await wait(800);
    await shot('a1-settings-connect');
    await js(`document.querySelector('#apiBibleKey').value = 'wrong-key-000'; document.querySelector('#apiBibleConnect').click();`); await wait(1000);
    assert.ok(await js(`return !!document.querySelector('#apiBibleKey')`), 'wrong key refused');
    await js(`document.querySelector('#apiBibleKey').value = '${KEY}'; document.querySelector('#apiBibleConnect').click();`);
    assert.ok(await until(`document.querySelector('#dlg .bv-row')`), 'versions listed');
    assert.equal(await js(`return document.querySelectorAll('#dlg .bv-row').length`), 2);
    assert.ok(!fs.readFileSync(path.join(process.env.WELLWRITE_DATA_DIR, 'apibible.json'), 'utf8').includes(KEY), 'key not stored in plain text');
    await shot('a2-choose-versions');
    await js(`document.querySelector('#dlg .bv-row input[value="${ID}"]').click(); document.querySelector('#dlgForm').requestSubmit();`);
    assert.ok(await until(`document.querySelector('#bibleTr option[value="api:${ID}"]')`), 'version offered');
    await js(`const s = document.querySelector('#bibleTr'); s.value = 'api:${ID}'; s.dispatchEvent(new Event('change'));`); await wait(800);
    assert.equal(await js(`return state.bible.state.translation`), 'api:' + ID);
    await shot('a3-settings-connected');
    await js(`document.querySelector('#dlg').close();`);

    // the week page uses it, with its copyright
    await js(`document.querySelector('.modeswitch [data-mode=quote]').click();`);
    assert.ok(await until(`document.querySelector('#quoteView .wk-scripture') && document.querySelector('#quoteView .wk-scripture').innerText.includes('TSV line one')`), 'week verses from API.Bible');
    assert.match(await text('#quoteView .wk-scripture .wk-refs'), /, TSV ▾\)/);
    assert.match(await text('#quoteView .wk-copy'), /Test Society/);
    assert.ok(hits.some(h => h.startsWith('/fums?t=tok-')), 'fair use reported');
    await js(`document.querySelector('#quoteView .wk-scripture').scrollIntoView()`); await shot('a4-week-tsv');

    // the verse of the day on the journal
    await js(`document.querySelector('.modeswitch [data-mode=journal]').click(); await newEntry(todayISO()); await updateSetting({ dailyCard: 'both' }); refreshQuote();`);
    assert.ok(await until(`document.querySelector('#quoteSlot .quote-card.verse') && document.querySelector('#quoteSlot .quote-card.verse').innerText.includes('TSV line one')`), 'verse of the day from API.Bible');
    assert.match(await text('#quoteSlot .quote-card.verse .q-copy'), /Test Society/);

    // a reading plan in TSV
    await js(`await saveBible({ plan: 'gospels30', translation: 'api:${ID}', start: todayISO(), done: [] }); state.bibleDay = null; setMode('bible');`);
    assert.ok(await until(`document.querySelector('#bibleView .passage') && document.querySelector('#bibleView .passage').innerText.includes('in TSV')`), 'reading from API.Bible');
    assert.match(await text('#bibleView'), /Test Society/);
    await shot('a5-reading-tsv');

    // offline: WEB instead, with a note
    server.close(); server.closeAllConnections && server.closeAllConnections(); await wait(300);
    await js(`state.bibleDay = 1; renderBibleView();`);
    assert.ok(await until(`document.querySelector('#bibleView .rv-note.warn')`), 'offline note');
    assert.ok(!(await text('#bibleView .passage')).includes('in TSV'), 'WEB text when offline');

    // disconnect: back to WEB
    await js(`openSettings('bible');`); await wait(800);
    await js(`[...document.querySelectorAll('#bibleVersions button')].find(b => b.textContent === 'Disconnect').click();`); await wait(1000);
    assert.equal(await js(`return (await api.bibleInfo()).state.translation`), 'web');
    assert.ok(await until(`document.querySelector('#apiBibleKey')`));

    assert.deepEqual(errors, [], 'no console errors');
    console.log('API.Bible e2e passed; shots in', OUT);
    fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
    app.exit(0);
  }).catch(e => { console.error(e); app.exit(1); });
});
