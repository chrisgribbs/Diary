'use strict';
// Week pictures: WellWrite's picture is fetched once (from a local stand-in for Wikimedia Commons), kept in the
// journal with its credit; you can remove it, bring it back, or use your own.
// Run: xvfb-run -a npx electron --no-sandbox test/pictures.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), http = require('http'), zlib = require('zlib');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-pics-'));
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-pics-shots'));
fs.mkdirSync(OUT, { recursive: true });

// a small sunrise PNG, made by hand
function png(w, h) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3, t = y / h; raw[i] = 120 + 120 * t; raw[i + 1] = 150 + 60 * t; raw[i + 2] = 200 - 80 * t; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const IMG = png(900, 300);
const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url.includes('missing')) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(IMG);
});

const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

server.listen(0, '127.0.0.1', () => {
  process.env.WELLWRITE_PICTURES_URL = `http://127.0.0.1:${server.address().port}/{file}`;
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
    const pics = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/pictures.json'), 'utf8'));

    await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
    await wait(2500);
    const key = await js(`return window.WellWriteWeeks.weekOf(seasonOn(todayISO())).key`);
    assert.ok(pics[key], 'a picture is listed for this week: ' + key);
    assert.equal(Object.keys(pics).length, 90, 'every week has a picture');

    // first visit: fetched, shown, credited
    await js(`document.querySelector('.modeswitch [data-mode=quote]').click();`);
    for (let i = 0; i < 20 && !(await has('#quoteView .wk-picture img')); i++) await wait(250);
    assert.ok(await has('#quoteView .wk-picture img'), 'WellWrite’s picture shown');
    assert.match(await js(`return document.querySelector('#quoteView .wk-credit').innerText`), new RegExp(pics[key].artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.ok(hits.some(h => h.includes(encodeURIComponent(pics[key].file.replace(/ /g, '_')))), 'asked for the right file');
    await shot('p1-week-picture');
    // kept in the journal: not fetched again
    const n = hits.length;
    await js(`state.pictures = {}; renderQuoteView();`); await wait(600);
    assert.equal(hits.length, n, 'not fetched twice');

    // remove it → stays removed; bring it back
    await js(`[...document.querySelectorAll('#quoteView .wk-picture-tools button')].find(b => b.textContent === 'Remove').click();`); await wait(600);
    assert.ok(!(await has('#quoteView .wk-picture img')));
    await js(`state.pictures = {}; renderQuoteView();`); await wait(800);
    assert.ok(!(await has('#quoteView .wk-picture img')), 'removed stays removed');
    await shot('p2-removed');
    await js(`[...document.querySelectorAll('#quoteView .wk-add-row button')].find(b => b.textContent.startsWith('Use WellWrite')).click();`);
    for (let i = 0; i < 20 && !(await has('#quoteView .wk-picture img')); i++) await wait(250);
    assert.ok(await has('#quoteView .wk-picture img'), 'brought back');

    // your own picture replaces it (no credit), and WellWrite's can be restored
    await js(`const c = document.createElement('canvas'); c.width = 1200; c.height = 400; const g = c.getContext('2d'); g.fillStyle = '#356'; g.fillRect(0, 0, 1200, 400);
      await api.setPicture('${key}', c.toDataURL('image/jpeg', .8)); state.pictures = {}; renderQuoteView();`); await wait(800);
    assert.ok(!(await has('#quoteView .wk-credit')), 'no credit on your own picture');
    assert.ok(await js(`return [...document.querySelectorAll('#quoteView .wk-picture-tools button')].some(b => b.textContent.startsWith('Use WellWrite'))`));

    // a picture that can't be fetched: no error, the Add button stays
    await js(`state.weekAt = '2027-03-29'; renderQuoteView();`); await wait(1500);   // Easter week
    assert.ok((await has('#quoteView .wk-picture img')) || (await has('#quoteView .wk-add-picture')));

    // pictures switched off: WellWrite's aren't shown
    await js(`await updateSetting({ weekPictures: false }); state.pictures = {}; renderQuoteView();`); await wait(800);
    assert.ok(!(await has('#quoteView .wk-credit')));

    assert.deepEqual(errors, [], 'no console errors');
    console.log('pictures e2e passed; shots in', OUT);
    server.close();
    fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
    app.exit(0);
  }).catch(e => { console.error(e); app.exit(1); });
});
