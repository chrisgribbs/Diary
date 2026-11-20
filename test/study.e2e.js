'use strict';
// Bible study, end to end: add a key, download the library, study a passage, see the sources, save to the journal,
// ask a follow-up question, and start a study from the reader, against a pretend OpenRouter and library release.
// Run: xvfb-run -a npx electron --no-sandbox test/study.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), http = require('http'), zlib = require('zlib'), crypto = require('crypto');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-study-'));
process.env.WELLWRITE_LIBRARY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-library-'));
process.env.WELLWRITE_TEST_TRUST = '1';
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-study-shots'));
fs.mkdirSync(OUT, { recursive: true });
const { writePack } = require('../scripts/library/pack');

// ---- a library release: one small pack
const RELEASE = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-release-'));
const sources = {
  vincent: { author: 'Marvin Vincent', work: 'Word Studies in the New Testament', year: 1887, licence: 'public-domain', credit: 'Marvin R. Vincent, Word Studies in the New Testament, vol. 1 (1887)', url: '', caveat: '' },
  edersheim: { author: 'Alfred Edersheim', work: 'The Life and Times of Jesus the Messiah', year: 1883, licence: 'public-domain', credit: 'Alfred Edersheim (1883)', url: '', caveat: 'Often reads later rabbinic writings back into the time of Jesus.' },
  meyer: { author: 'F. B. Meyer', work: 'Through the Bible Day by Day', year: 1914, licence: 'public-domain', credit: 'F. B. Meyer, Through the Bible Day by Day (1914)', url: '', caveat: '' },
};
const passages = [
  { src: 'vincent', cat: 'greek', refs: [[39, 11, 29, 11, 29]], section: 'Matthew 11:29', text: 'Meek (πραΰς). Gentleness that is not weakness; the opposite of harshness.\n\nLowly (ταπεινὸς) in heart.' },
  { src: 'vincent', cat: 'greek', refs: [[39, 11, 30, 11, 30]], section: 'Matthew 11:30', text: 'Easy (χρηστὸς). Kindly, good to wear: a yoke that fits well and does not chafe.' },
  { src: 'edersheim', cat: 'history', refs: [[39, 11, 28, 11, 30]], section: 'Book III, chapter 1', text: 'The yoke was a common figure among the rabbis for the law and its commandments, which lay heavily on the people.' },
  { src: 'meyer', cat: 'devotional', refs: [[39, 11, 25, 11, 30]], section: 'Matthew 11:25–30', text: 'There is rest in yielding to the yoke. The ox that pulls against it is galled; the one that walks with it finds it easy.' },
];
const ready = (async () => {
  const dir = path.join(RELEASE, 'build');
  await writePack(dir, { id: 'commentary', name: 'Commentaries', about: 'Meyer, Vincent and Edersheim (test)', passages, sources });
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const gz = zlib.gzipSync(fs.readFileSync(path.join(dir, name)));
    fs.writeFileSync(path.join(RELEASE, `commentary-${name}.gz`), gz);
    files.push({ name, size: gz.length, sha256: crypto.createHash('sha256').update(gz).digest('hex') });
  }
  fs.writeFileSync(path.join(RELEASE, 'library.json'), JSON.stringify({ version: 1, packs: [{ id: 'commentary', name: 'Commentaries', about: 'Meyer, Vincent and Edersheim (test)', version: 1, files }] }));
})();

const STUDY = `# The yoke that fits

## Understanding the passage
A tired crowd on a dusty road, and a carpenter who knew how a yoke was made. Jesus does not offer an empty life; he offers a different way of carrying it [S2].

## Historical and cultural background
The rabbis spoke of the law as a yoke, "a common figure among the rabbis for the law and its commandments" [S2].

## Greek and Hebrew words
*Meek* translates πραΰς, a gentleness that is not weakness [S1]. *Easy* is χρηστὸς: kindly, a yoke that fits well [S3].

## Commentary
Rest here is not the absence of work. It is work done alongside someone.

## Theological implications
Grace does not remove the yoke; it changes who is carrying it with you.

## Living it today
Notice what you carry alone.

## Contemplative reflection
Breathe slowly. Feel the weight of the day settle. Let it be shared.

## Questions for your journal
1. What am I carrying today that no one has asked me to carry?
2. Do you feel tired?
3. When have I felt yoked to someone, and what did it make easier or harder?

## Closing prayer
Gentle Christ, you know the weight I bring.
May you find the rest that is given, not earned.`;

const TEACHING = `# An invitation to the weary

## Understanding the passage
These words were spoken to ordinary people in the towns around the Sea of Galilee: farmers, fishermen, labourers, and the many who felt they could never keep the religious rules well enough. Jesus had just spoken of the wise who missed the point and the simple who saw it. Now he turns to the tired and says, in effect, "Come to me" [S2].

## Historical and cultural background
A yoke was an everyday thing. It was a wooden beam laid across the necks of two oxen so they could pull together, and a carpenter would shape it to fit the animal that wore it. The teachers of the day spoke of taking up the yoke of the law, meaning a life lived under its many commandments [S2]. So when Jesus speaks of *his* yoke, his hearers would have heard an offer of a different teacher and a different way of living.

## Greek and Hebrew words
The word translated *easy* is *chrēstos* [S1]. It does not mean that the way is light work. It means kindly, good and well-fitting, the word you might use of something made for you that does not chafe [S3]. The yoke of Jesus is shaped to the one who wears it.

## What the passage teaches
(i) **Jesus speaks to those who are worn out.** The invitation is not to the strong but to the weary. The first qualification for coming to him is simply needing to.

(ii) **Rest is not the absence of a yoke.** He does not promise a life without work or responsibility. He offers a yoke that fits, and a companion in the pulling [S1].

(iii) **The teacher is gentle.** He calls himself *gentle and lowly in heart*. The one who sets the yoke on us does not drive us; he walks beside us [S3].

## Living it today
Most of us carry more than we were asked to. Today, notice one weight you have picked up out of habit, fear or pride, and ask whether it is really yours to carry.

## Questions for your journal
1. What am I carrying today that no one has asked me to carry?
2. Where in my week does the yoke chafe, and what might a better fit look like?
3. When have I pulled alongside someone, and what did it make easier?

## Closing prayer
Lord Jesus, you know the weight I bring. Teach me to walk in step with you, and to find the rest you give.`;

let SLOW = false;   // stream slowly, to leave the page mid-study
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const json = (status, b) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (req.url.startsWith('/release/')) {
      const f = path.join(RELEASE, path.basename(req.url));
      if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); res.end(fs.readFileSync(f)); return;
    }
    if (req.headers.authorization !== 'Bearer sk-or-v1-e2etestkey1234567890') return json(401, { error: { message: 'No auth' } });
    if (req.url === '/api/v1/key') return json(200, { data: { label: 'e2e', usage: 0.25, limit: 5 } });
    if (req.url === '/api/v1/chat/completions') {
      const b = JSON.parse(body);
      if (!b.stream) {
        if (/numbered list/.test(b.messages[1].content)) return json(200, { choices: [{ message: { content: '1. What am I carrying today that no one has asked me to carry?\n2. Where in my life does rest feel least possible, and what does that place ask of me?\n3. When have I felt yoked to someone, and what did it make easier or harder?' } }], usage: { cost: 0.0001 } });
        return json(200, { choices: [{ message: { content: 'Matthew 11:28-30' } }], usage: {} });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const text = /the reader’s question/.test(b.messages[1].content)
        ? 'To a crowd worn down by rules, a yoke meant the law [S1]. Jesus offers his own instead: a teacher who walks beside them.'
        : /gifted teacher/.test(b.messages[1].content) ? TEACHING : STUDY;
      const pieces = text.match(/[\s\S]{1,40}/g);
      let i = 0;
      const tick = () => {
        if (i < pieces.length) { res.write(`data: ${JSON.stringify({ model: 'test/model', choices: [{ delta: { content: pieces[i++] } }] })}\n\n`); setTimeout(tick, SLOW ? 90 : 8); return; }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 3000, completion_tokens: 900, cost: 0.0031 } })}\n\ndata: [DONE]\n\n`);
        res.end();
      };
      tick();
      return;
    }
    json(404, {});
  });
});

ready.then(() => server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  process.env.WELLWRITE_OPENROUTER_URL = `http://127.0.0.1:${port}/api/v1`;
  process.env.WELLWRITE_LIBRARY_URL = `http://127.0.0.1:${port}/release`;
  run();
}));

function run() {
  const { app } = require('electron');
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
  const { getWindow } = require('../main.js');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];
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
    const until = async (cond, ms = 8000) => { for (let t = 0; t < ms; t += 150) { if (await js(`return !!(${cond})`)) return true; await wait(150); } return false; };
    // Waits up to 3 s for the button: the Study tab checks with the engine (for a study in progress) before drawing.
    const click = (sel, label) => js(`for (let t = 0; t < 60; t++) { const b = [...document.querySelectorAll('${sel}')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (b) { b.click(); return; } await new Promise(r => setTimeout(r, 50)); } throw new Error('no button ${label}');`);

    try {
      await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
      await wait(2500);
      await js(`await api.save({ date: '2026-11-10', title: 'Heavy week', html: '<p>A heavy week. I labor all day and cannot rest. My soul feels the burden.</p>', text: 'A heavy week. I labor all day and cannot rest. My soul feels the burden and I am weary of carrying it alone.' }); state.metas = await api.list(); renderSidebar();`);

      // The Study tab, before a key or library
      await js(`document.querySelector('.modeswitch [data-mode=bible]').click();`);
      assert.ok(await until(`document.querySelector('.bv-tab[data-tab=study]')`), 'Study tab exists');
      await js(`document.querySelector('.bv-tab[data-tab=study]').click();`);
      assert.ok(await until(`document.querySelector('.st-start')`));
      assert.match(await text('.st-start'), /add an OpenRouter key/i);
      assert.match(await text('.st-start'), /commentary library isn’t on this device/);
      await shot('s1-start');

      // Settings → Bible study: key and library
      await js(`openSettings('study');`);
      assert.ok(await until(`document.querySelector('#studySettings .st-keyrow')`), 'key box shown');
      await js(`const i = document.querySelector('#studySettings input[type=password]'); i.value = 'sk-or-v1-wrong000000000000'; [...document.querySelectorAll('#studySettings button')].find(b => b.textContent === 'Save').click();`);
      assert.ok(await until(`/didn’t accept/.test((document.querySelector('#studySettings .st-keynote') || {}).textContent || '')`), 'a wrong key is refused, and says so');
      // The message shows inside Settings (which sits above the page, hiding any toast).
      assert.ok(await js(`const n = document.querySelector('#studySettings .st-keynote'); const r = n.getBoundingClientRect(); const top = document.elementFromPoint(r.left + 4, r.top + r.height / 2); return r.height > 0 && (top === n || n.contains(top));`), 'the message can be seen');
      await shot('s2a-wrong-key');
      await js(`const i = document.querySelector('#studySettings input[type=password]'); i.value = 'sk-or-v1-e2etestkey1234567890'; [...document.querySelectorAll('#studySettings button')].find(b => b.textContent === 'Save').click();`);
      assert.ok(await until(`[...document.querySelectorAll('#studySettings button')].some(b => b.textContent === 'Check credit')`), 'key saved');
      assert.ok(await until(`[...document.querySelectorAll('#studySettings .st-lib button')].some(b => /Download/.test(b.textContent))`), 'library offered');
      await shot('s2-settings');
      await js(`[...document.querySelectorAll('#studySettings .st-lib button')].find(b => /Download/.test(b.textContent)).click();`);
      assert.ok(await until(`[...document.querySelectorAll('#studySettings .st-lib button')].some(b => b.textContent === 'Remove')`), 'library downloaded');
      assert.ok(fs.existsSync(path.join(process.env.WELLWRITE_LIBRARY_DIR, 'commentary', 'manifest.json')), 'the pack is in the library folder, outside the journal');
      assert.ok(!fs.existsSync(path.join(process.env.WELLWRITE_DATA_DIR, 'library')));
      await js(`document.querySelector('#dlg .btn-ink.btn-small, #dlg [data-done]') ? document.querySelector('#dlg .btn-ink.btn-small').click() : document.querySelector('#dlg').close();`);
      await wait(400);

      // A passage, and what the sources say
      await js(`renderBibleView();`);
      assert.ok(await until(`document.querySelector('.st-start .st-input')`));
      await js(`const i = document.querySelector('.st-start .st-input'); i.value = 'Matt 11:28-30'; [...document.querySelectorAll('.st-start .btn-ink')].find(b => b.textContent === 'Study').click();`);
      assert.ok(await until(`document.querySelector('.st-h') && document.querySelector('.st-h').textContent === 'Matthew 11:28–30'`), 'passage chosen');
      assert.match(await text('.st-passage'), /my burden is light/);
      await click('.st-actions button', 'What the sources say');
      assert.ok(await until(`document.querySelectorAll('.st-src').length >= 3`), 'sources listed');
      assert.match(await text('.st-sources'), /Alfred Edersheim/);
      await js(`document.querySelector('.st-src summary').click();`);
      await shot('s3-sources');
      await click('.st-back', '‹ Matthew');
      assert.ok(await until(`[...document.querySelectorAll('.st-actions button')].some(b => b.textContent === 'Write the study')`));

      // Write the study
      await click('.st-actions button', 'Write the study');
      assert.ok(await until(`document.querySelector('.st-live')`, 3000), 'writing view');
      assert.ok(await until(`document.querySelector('.st-question')`, 15000), 'study shown');
      assert.equal(await text('.st-title'), 'The yoke that fits');
      assert.match(await text('.st-lead'), /carpenter/);
      assert.equal(await js(`return document.querySelectorAll('.st-part:not(.st-sources)').length`), 6, 'parts to explore');
      assert.match(await text('.st-q'), /What am I carrying today/);
      assert.ok(!/Do you feel tired/.test(await text('.st-question')), 'a yes/no question was rewritten');
      assert.ok(await js(`return document.querySelectorAll('.st-cite').length > 2`), 'source labels are buttons');
      assert.match(await text('.st-foot'), /test\/model/);
      await shot('s4-study');
      await js(`document.querySelectorAll('.st-part')[2].open = true; document.querySelectorAll('.st-part')[2].scrollIntoView();`);
      await shot('s5-study-words');

      // Your reflection, saved to the journal
      await js(`const r = document.querySelector('.st-reflect'); r.value = 'I carry the week alone. Perhaps I need not.'; r.dispatchEvent(new Event('input'));`);
      await js(`document.querySelector('.st-reflect').scrollIntoView({ block: 'center' });`);
      await shot('s6-reflection');
      await click('.st-question .btn-ink', 'Save to my journal');
      assert.ok(await until(`[...document.querySelectorAll('.st-question button')].some(b => b.textContent === 'Open in journal')`), 'saved');
      const saved = await js(`const m = (await api.list()).find(x => x.category === 'bible-study'); const e = m && await api.get(m.id); return e && { title: e.title, html: e.html };`);
      assert.equal(saved.title, 'The yoke that fits');
      assert.match(saved.html, /My reflection/);
      assert.match(saved.html, /I carry the week alone/);
      assert.match(saved.html, /Marvin Vincent/);
      assert.ok(!/<script/i.test(saved.html));

      // A follow-up question
      await js(`const i = document.querySelector('.st-ask textarea'); i.value = 'What would this have meant to its first hearers?'; [...document.querySelectorAll('.st-ask button')].find(b => b.textContent === 'Ask').click();`);
      assert.ok(await until(`/worn down by rules/.test(document.querySelector('.st-thread').innerText)`, 8000), 'answer shown');
      await js(`document.querySelector('.st-ask').scrollIntoView();`);
      await shot('s7-ask');

      // History
      await click('.st-back', '‹ New study');
      await click('.st-links button', 'Your studies');
      assert.ok(await until(`document.querySelectorAll('.st-hist .bv-row').length === 1`));
      assert.match(await text('.st-hist'), /saved/);

      // Teaching Study: a teacher's voice, its parts open, and Barclay one click away (linked, never fetched).
      await js(`study.passage = await api.studyPick({ kind: 'ref', text: 'Matthew 11:28-30' }); study.mode = 'teaching'; study.view = 'passage'; studyRedraw();`);
      assert.ok(await until(`[...document.querySelectorAll('.st-actions button')].some(b => b.textContent === 'Write the study')`));
      await click('.st-actions button', 'Write the study');
      assert.ok(await until(`document.querySelector('.st-title') && document.querySelector('.st-title').textContent === 'An invitation to the weary' && document.querySelector('.st-question')`, 15000), 'teaching study shown');
      assert.equal(await js(`return document.querySelectorAll('.st-part:not(.st-sources)').length`), 4, 'background, words, lessons, living it');
      assert.ok(await js(`return [...document.querySelectorAll('.st-part:not(.st-sources)')].every(d => d.open) && !document.querySelector('details.st-sources').open`), 'a teaching study opens out to read');
      assert.ok(await js(`return [...document.querySelectorAll('.st-part summary')].some(s => s.textContent === 'What the passage teaches')`));
      assert.match(await text('.st-barclay'), /Barclay’s Daily Study Bible on Matthew 11/);
      // Sources fold away, in the study and in the copy saved to the journal (printed open).
      assert.match(await text('details.st-sources summary'), /^Sources \(\d+\)$/);
      const savedHtml = await js(`return studyHtml(study.current, '')`);
      assert.match(savedHtml, /<details><summary>Sources \(\d+\)<\/summary><ol>/);
      assert.ok(!/Public domain\. Public domain\./.test(savedHtml), 'the credit says public domain once');
      assert.ok(await js(`return clean('<details><summary>Sources (2)</summary><ol><li>x</li></ol></details>').includes('<summary>')`), 'journal entries keep a folded section');
      await shot('s7b-teaching');
      await js(`[...document.querySelectorAll('.st-part summary')].find(s => s.textContent === 'What the passage teaches').scrollIntoView();`);
      await shot('s7c-teaching-lessons');
      await js(`document.querySelector('.st-barclay').scrollIntoView({ block: 'center' });`);
      await shot('s7d-barclay');
      await click('.st-back', '‹ New study');

      // From the reader: tap verses, then Study
      await js(`state.bibleTab = 'read'; setReaderPos(18, 23); renderBibleView();`);
      assert.ok(await until(`document.querySelector('.rd-title') && document.querySelector('.rd-title').textContent === 'Psalm 23'`));
      await js(`document.querySelector('.rd-v[data-v="1"]').click(); document.querySelector('.rd-v[data-v="2"]').click(); document.querySelector('.rd-v[data-v="3"]').click();`);
      await click('.rd-selbar button', 'Study');
      assert.ok(await until(`document.querySelector('.st-h') && document.querySelector('.st-h').textContent === 'Psalm 23:1–3'`), 'study from the reader');

      // Personal Reflection: nothing from the journal without permission; then only what's ticked.
      await js(`const s = document.querySelector('.st-opts select'); s.value = 'personal'; s.dispatchEvent(new Event('change'));`);
      assert.ok(await until(`/only if you allow it/.test(document.querySelector('#stJournal').innerText)`), 'asks permission first');
      await js(`await updateSetting({ studyJournal: true }); study.status = await api.studyStatus(); study.journal = null; study.passage = await api.studyPick({ kind: 'ref', text: 'Matthew 11:28-30' }); study.mode = 'personal'; studyRedraw();`);
      assert.ok(await until(`document.querySelector('.st-jrow')`), 'matching entry offered');
      assert.equal(await js(`return document.querySelector('.st-jrow input').checked`), false, 'nothing is ticked for you');
      await shot('s8-personal');

      // A study carries on when the page loses track of it (a phone recreating its screen) and when the journal is
      // locked and opened again: the engine keeps it, and the page picks it up, then shows the finished study once.
      SLOW = true;
      await js(`study.passage = await api.studyPick({ kind: 'ref', text: 'Matthew 11:28-30' }); study.mode = 'devotional'; study.view = 'passage'; studyRedraw();`);
      assert.ok(await until(`[...document.querySelectorAll('.st-actions button')].some(b => b.textContent === 'Write the study')`));
      await click('.st-actions button', 'Write the study');
      assert.ok(await until(`/^Writing “/.test((document.querySelector('.st-phase') || {}).textContent || '')`, 10000), 'it says which part it is writing');
      await js(`Object.assign(study, { view: 'start', rid: '', writing: null, live: '', phase: '' }); studyRedraw();`);
      assert.ok(await until(`document.querySelector('.st-live') && document.querySelector('.st-live').textContent.length > 40`, 5000), 'the page picks the study up again, with what was written so far');
      await shot('s13-picked-up');
      await js(`lockNow();`); await wait(800);
      await js(`document.querySelector('#unlockPw').value='river-stone'; document.querySelector('#unlockForm').requestSubmit();`); await wait(2500);
      SLOW = false;
      await js(`document.querySelector('.modeswitch [data-mode=bible]').click();`); await wait(300);
      await js(`document.querySelector('.bv-tab[data-tab=study]').click();`);
      assert.ok(await until(`document.querySelector('.st-question') && document.querySelector('.st-title').textContent !== 'Writing…'`, 20000), 'the finished study is there after unlocking');
      const shown = await js(`return study.current.id`);
      assert.ok(await js(`return (await api.studyHistory()).some(h => h.id === ${JSON.stringify('X')}.replace('X', study.current.id))`), 'and saved to your studies');
      await js(`study.view = 'start'; studyRedraw();`); await wait(400);
      assert.notEqual(await js(`return study.view`), 'study', 'shown once, not every time');
      assert.equal(await js(`return study.current.id`), shown);

      // The verse of the day's Study button opens Bible study on that verse.
      await js(`const c = verseCard({ text: 'Be content with what you have.', ref: 'Hebrews 13:5', translation: 'web' }, '2026-11-19', 'top'); document.body.append(c); [...c.querySelectorAll('button')].find(b => b.textContent === 'Study').click(); setTimeout(() => c.remove(), 100);`);
      assert.ok(await until(`study.passage && study.passage.label === 'Hebrews 13:5' && state.mode === 'bible' && state.bibleTab === 'study'`), 'the verse card opens a study on its verse');

      // Phone width
      win.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 393, height: 852 }, viewSize: { width: 393, height: 852 }, deviceScaleFactor: 1, viewPosition: { x: 0, y: 0 }, scale: 1 });
      await wait(800);
      assert.equal(await js(`return innerWidth`), 393, 'phone width');
      await js(`study.current = (await api.studyGet((await api.studyHistory())[0].id)); study.view = 'study'; state.bibleTab = 'study'; renderBibleView();`);
      assert.ok(await until(`document.querySelector('.st-question')`));
      await shot('s9-phone');
      const overflow = await js(`const w = innerWidth; return [...document.querySelectorAll('.st-card *')].filter(n => n.getClientRects().length && n.getBoundingClientRect().right > w + 1).map(n => n.className || n.tagName).slice(0, 5)`);
      assert.deepEqual(overflow, [], 'nothing runs off a phone screen');
      await js(`document.querySelector('.st-question').scrollIntoView();`);
      await shot('s10-phone-question');
      await js(`study.view = 'start'; renderBibleView();`);
      await shot('s11-phone-start');
      const overflow2 = await js(`const w = innerWidth; return [...document.querySelectorAll('.st-start *')].filter(n => n.getClientRects().length && n.getBoundingClientRect().right > w + 1).map(n => n.className || n.tagName).slice(0, 5)`);
      assert.deepEqual(overflow2, [], 'the start screen fits a phone');

      // Settings → Bible study on a phone: the page scrolls, so the library's Download buttons can be reached.
      await js(`openSettings('study');`);
      assert.ok(await until(`document.querySelector('#studySettings .st-lib, #studySettings button') && /Download|Update|Included/.test(document.querySelector('#studySettings').innerText)`, 8000));
      const sc = await js(`const c = document.querySelector('#dlg .set-content'); const before = c.scrollTop; c.scrollTop = 99999; const r = { overflow: getComputedStyle(c).overflowY, client: c.clientHeight, scroll: c.scrollHeight, moved: c.scrollTop - before, dlg: document.querySelector('#dlg').clientHeight }; return r;`);
      assert.ok(sc.client <= sc.dlg && sc.scroll > sc.client && sc.moved > 0, 'a long settings section scrolls on a phone: ' + JSON.stringify(sc));
      assert.ok(await js(`const b = [...document.querySelectorAll('#studySettings button')].find(x => /^(Download|Update)/.test(x.textContent)) || document.querySelector('#studySettings .st-small:last-child'); const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0;`), 'the library can be reached');
      await shot('s12-phone-settings-bottom');
      assert.ok(!/(^|\n)\s*null\s*(\n|$)/.test(await text('#studySettings')), 'no stray "null" in the settings');
      const bad = errors.filter(e => !/Autofill|DevTools|favicon/.test(e));
      assert.deepEqual(bad, [], 'no errors on the page');
      console.log('study e2e passed; screenshots in ' + OUT);
      app.exit(0);
    } catch (e) {
      console.error(e);
      await shot('FAILED').catch(() => {});
      console.error('page errors:', errors);
      app.exit(1);
    }
  });
}
