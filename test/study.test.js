'use strict';
// Bible study: references, the library and its packs, retrieval, the checks, the OpenRouter client, and a whole
// study written through the engine against a pretend OpenRouter.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const refs = require('../src/study/refs');
const { Library, tokenize } = require('../src/study/library');
const { chunk, writePack } = require('../scripts/library/pack');
const { retrieve } = require('../src/study/retrieve');
const { verify, questionProblems, questionsOf, replaceQuestions } = require('../src/study/verify');
const prompts = require('../src/study/prompts');
const { OpenRouter } = require('../src/study/openrouter');
const { createBackend } = require('../src/backend');

// ---------- references ----------
assert.deepEqual(refs.parse('Mt 11:28-30'), [39, 11, 28, 11, 30]);
assert.deepEqual(refs.parse('Matt. xi. 28'), [39, 11, 28, 11, 28]);
assert.deepEqual(refs.parse('Ps. cxix. 105'), [18, 119, 105, 119, 105]);
assert.deepEqual(refs.parse('John 3:16–4:2'), [42, 3, 16, 4, 2]);
assert.deepEqual(refs.parse('Rom 8'), [44, 8, 0, 8, 0]);
assert.equal(refs.parse('Nonsense 4:5'), null);
assert.equal(refs.label([39, 11, 28, 11, 30]), 'Matthew 11:28–30');
assert.equal(refs.label([18, 23, 0, 23, 0]), 'Psalm 23');
const P = [39, 11, 28, 11, 30];
assert.ok(refs.closeness([39, 11, 28, 11, 30], P) > refs.closeness([39, 11, 25, 11, 30], P));
assert.ok(refs.closeness([39, 11, 25, 11, 30], P) > refs.closeness([39, 11, 0, 11, 0], P));
assert.equal(refs.closeness([39, 12, 1, 12, 5], P), 0);
assert.deepEqual(refs.findIn('Compare Isa. 9:4 and Jer. vi. 16, also Matt 11:29.'), [[22, 9, 4, 9, 4], [23, 6, 16, 6, 16], [39, 11, 29, 11, 29]]);

// ---------- words and chunks ----------
assert.deepEqual(tokenize('The Burdens, and the burdened!'), ['burden', 'burden']);
const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} speaks of the yoke and of rest. `.repeat(8)).join('\n\n');
const chunks = chunk([{ src: 'x', section: 'Long', refs: [P], text: long }, { src: 'x', section: 'Short', refs: [P], text: 'A short note.' }]);
assert.ok(chunks.length >= 3, 'a long section is split');
for (const c of chunks.slice(0, -1)) assert.ok(c.text.length / 4 <= 820, 'chunks stay near 800 tokens');
assert.ok(chunks.slice(1).every(c => c.section === 'Long' ? c.text.startsWith('… ') || c.text.startsWith('Paragraph') : true));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-study-'));
  const libDir = path.join(tmp, 'device', 'library');

  // ---------- a small pack, as the builder makes them ----------
  const sources = {
    vincent: { author: 'Marvin Vincent', work: 'Word Studies in the New Testament', year: 1887, licence: 'public-domain', credit: 'Vincent, Word Studies, vol. 1 (1887)', url: 'https://example.org/vincent', caveat: '' },
    edersheim: { author: 'Alfred Edersheim', work: 'The Life and Times of Jesus the Messiah', year: 1883, licence: 'public-domain', credit: 'Edersheim (1883)', url: '', caveat: 'Often reads later rabbinic writings back into the time of Jesus.' },
    maclaren: { author: 'Alexander Maclaren', work: 'Expositions of Holy Scripture', year: 1906, licence: 'public-domain', credit: 'Maclaren (1906)', url: '', caveat: '' },
  };
  const passages = [
    { src: 'vincent', cat: 'greek', refs: [[39, 11, 29, 11, 29]], section: 'Matthew 11:29', text: 'Meek (πραΰς). The word praus describes a gentleness that is not weakness. Lowly (ταπεινὸς) in heart.' },
    { src: 'vincent', cat: 'greek', refs: [[39, 11, 30, 11, 30]], section: 'Matthew 11:30', text: 'Easy (χρηστὸς). Kindly, good to wear: a yoke that fits well.' },
    { src: 'vincent', cat: 'greek', refs: [[39, 11, 28, 11, 28]], section: 'Matthew 11:28', text: 'Labour and are heavy laden. The one word of toil, the other of burdens laid on.' },
    { src: 'edersheim', cat: 'history', refs: [[39, 11, 28, 11, 30]], section: 'Book III', text: 'The yoke was a common figure among the rabbis for the law and its commandments, which lay heavily on the people.' },
    { src: 'maclaren', cat: 'exposition', refs: [[39, 11, 28, 11, 28]], section: 'The Great Invitation', text: 'Christ offers rest not by taking away all burden but by giving us his own yoke, which makes every burden light.' },
    { src: 'maclaren', cat: 'exposition', refs: [[44, 8, 28, 8, 28]], section: 'All Things Work Together', text: 'All things work together for good to them that love God.' },
  ];
  await writePack(path.join(libDir, 'commentary'), { id: 'commentary', name: 'Test commentary', passages, sources });
  assert.ok(fs.existsSync(path.join(libDir, 'commentary', 'text.bin')));
  await assert.rejects(writePack(path.join(tmp, 'bad'), { id: 'bad', name: 'x', passages: [{ src: 'nobody', text: 'x' }], sources }), /unknown source/);

  const lib = new Library({ dir: libDir, fetch: null, builtinFile: path.join(__dirname, '..', 'src', 'readings', 'classics.json') });
  assert.ok(lib.hasPacks());
  assert.deepEqual(lib.installed().map(p => p.id).sort(), ['classics', 'commentary']);
  const r1 = lib.byRef(P);
  assert.equal(lib.passage(r1[0].pack, r1[0].i).author, 'Alfred Edersheim', 'the note on exactly these verses comes first');
  assert.ok(!r1.some(h => lib.passage(h.pack, h.i).section === 'All Things Work Together'), 'Romans 8 is not about Matthew 11');
  assert.equal(lib.byId('commentary:0').text.slice(0, 4), 'Meek');

  // ---------- retrieval ----------
  const passageText = '“Come to me, all you who labor and are heavily burdened, and I will give you rest. Take my yoke upon you, and learn from me, for I am gentle and humble in heart; and you will find rest for your souls. For my yoke is easy, and my burden is light.”';
  const got = await retrieve(lib, null, { ref: P, passageText, mode: 'deep', length: 'standard' });
  assert.ok(got.length >= 3);
  assert.equal(got.filter(s => s.author === 'Marvin Vincent').length, 2, 'no work gives more than two passages');
  assert.ok(got.slice(0, 4).every(s => s.why === 'verses'), 'passages on the verses come first');
  assert.ok(!got.some(s => s.section === 'All Things Work Together'));
  const tiny = await retrieve(lib, null, { ref: P, passageText, mode: 'devotional', length: 'short' }, { budget: 200 });
  assert.ok(tiny.reduce((n, s) => n + s.text.length, 0) <= 400, 'the budget is kept');

  // ---------- the checks ----------
  const src = got.slice(0, 3);
  const vincentIdx = src.findIndex(s => s.author === 'Marvin Vincent') + 1;
  const md = [
    '# Rest that fits',
    '## Greek and Hebrew words',
    `The word for meek, πραΰς (*praus*), is not weakness [S${vincentIdx}]. The word *hypomone* is also here. And λόγος appears too.`,
    '## Commentary',
    `Edersheim notes that "the yoke was a common figure among the rabbis" [S1]. Someone said "rest is the reward of the faithful who wait" [S9].`,
    'Jesus says “I will give you rest” and more.',
    '## Questions for your journal',
    '1. What am I carrying today that no one has asked me to carry?',
    '2. Do you trust God with your burdens?',
    '3. How can I rest in Jesus more?',
  ].join('\n');
  const v = verify(md, { sources: src, passageText, inBible: () => false });
  assert.ok(v.md.includes('the yoke was a common figure among the rabbis"'), 'a real quotation keeps its marks');
  assert.ok(!v.md.includes('"rest is the reward'), 'an invented quotation loses its marks');
  assert.ok(v.flags.some(f => f.kind === 'quote'));
  assert.ok(!v.md.includes('[S9]') && v.flags.some(f => f.kind === 'label'), 'unknown source labels are removed');
  assert.ok(v.md.includes('“I will give you rest” and'), 'short or Scripture quotations are fine');
  assert.ok(/λόγος \(not found in the sources\)/.test(v.md), 'Greek not in the sources is marked');
  assert.ok(!/πραΰς \(not found/.test(v.md), 'Greek in the sources is not');
  assert.ok(/\*hypomone\* \(not found in the sources\)/.test(v.md));
  assert.ok(!/\*praus\* \(not found/.test(v.md));
  assert.equal(v.questionProblems.length, 2);
  assert.deepEqual(questionProblems('What am I carrying today that no one has asked me to carry?'), []);
  assert.ok(questionProblems('Should I pray more?').includes('can be answered yes or no'));
  assert.ok(questionProblems('How might I lean into this season?').some(p => p.includes('lean into')));
  assert.equal(questionsOf(replaceQuestions(md, ['Where does rest feel least possible for me?', 'When have I felt yoked to someone?'])).length, 2);

  // ---------- prompts ----------
  const msgs = prompts.studyMessages({ ref: 'Matthew 11:28–30', passageText, mode: 'lectio', length: 'short' }, src);
  assert.equal(msgs[0].role, 'system');
  assert.ok(/Attention before explanation/.test(msgs[0].content) && /Threshold and paradox/.test(msgs[0].content), 'the voice is in the system prompt');
  assert.ok(/honest|open room|steers/i.test(msgs[0].content));
  assert.ok(msgs[1].content.includes('## Reading slowly') && msgs[1].content.includes('[S1] '));
  assert.ok(!/William Barclay/.test(msgs[0].content), 'no writer is named as a style to copy');

  // ---------- OpenRouter, pretend ----------
  const calls = [];
  const stream = pieces => {
    const enc = new TextEncoder();
    const lines = pieces.map(p => `data: ${JSON.stringify({ model: 'test/model', choices: [{ delta: { content: p } }] })}\n\n`);
    lines.splice(1, 0, ': OPENROUTER PROCESSING\n\n');
    lines.push(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 900, completion_tokens: 300, cost: 0.0012 } })}\n\n`, 'data: [DONE]\n\n');
    const bytes = lines.map(l => enc.encode(l));
    let i = 0;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < bytes.length ? { done: false, value: bytes[i++] } : { done: true }) }) } };
  };
  const STUDY = [
    '# The yoke that fits\n\n## Understanding the passage\nA tired crowd, and an invitation.\n\n',
    '## Historical and cultural background\nThe rabbis spoke of the law as a yoke [S1].\n\n## Greek and Hebrew words\nMeek, πραΰς, is gentleness that is not weakness.\n\n',
    '## Commentary\nRest is given, not earned.\n\n## Theological implications\nGrace.\n\n## Living it today\nNotice the weight.\n\n## Contemplative reflection\nBreathe.\n\n',
    '## Questions for your journal\n1. What am I carrying today that no one has asked me to carry?\n2. Do you feel tired?\n\n## Closing prayer\nMay you find rest.',
  ];
  const fakeFetch = async (url, opts = {}) => {
    const auth = opts.headers && opts.headers.Authorization;
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, auth, body });
    const json = (status, b) => ({ ok: status < 300, status, json: async () => b });
    if (auth !== 'Bearer sk-or-v1-goodkey1234567890') return json(401, { error: { message: 'No auth credentials found' } });
    if (url.endsWith('/key')) return json(200, { data: { label: 'test', usage: 0.5, limit: 10 } });
    if (url.endsWith('/chat/completions')) {
      if (body.stream) return stream(STUDY);
      if (/numbered list/.test(body.messages[1].content)) return json(200, { model: 'test/model', choices: [{ message: { content: '1. What am I carrying today that no one has asked me to carry?\n2. Where does rest feel least possible in my week?' } }], usage: { cost: 0.0001 } });
      if (/suggest one Bible passage/.test(body.messages[0].content)) return json(200, { choices: [{ message: { content: 'Matthew 11:28-30' } }], usage: {} });
      return json(200, { choices: [{ message: { content: 'ok' } }], usage: {} });
    }
    if (url.endsWith('/embeddings')) return json(200, { data: body.input.map((_, index) => ({ index, embedding: [1, 0, 0] })), usage: { prompt_tokens: 5 } });
    return json(404, {});
  };

  const or = new OpenRouter({ file: path.join(tmp, 'or.json'), protect: s => 'p:' + s, unprotect: s => s.slice(2), fetch: fakeFetch, usageFile: path.join(tmp, 'usage.json') });
  await assert.rejects(or.setKey('nonsense'), /doesn’t look like/);
  await assert.rejects(or.setKey('sk-or-v1-badkey12345678901'), /didn’t accept your key/);
  assert.equal(or.hasKey(), false);
  await or.setKey('sk-or-v1-goodkey1234567890');
  assert.ok(or.hasKey());
  assert.ok(!fs.readFileSync(path.join(tmp, 'or.json'), 'utf8').includes('goodkey') || fs.readFileSync(path.join(tmp, 'or.json'), 'utf8').includes('p:'), 'the key is stored protected');
  let streamed = '';
  const res = await or.chat({ model: 'test/model', messages: [{ role: 'user', content: 'hi' }], onDelta: p => { streamed += p; } });
  assert.equal(res.text, STUDY.join(''));
  assert.equal(streamed, res.text);
  assert.equal(res.usage.cost, 0.0012);
  assert.deepEqual(calls[calls.length - 1].body.provider, { data_collection: 'deny' }, 'asks for hosts that keep nothing');
  assert.equal(or.month().requests, 1);
  assert.ok(Math.abs(or.month().usd - 0.0012) < 1e-9);
  const noFetch = new OpenRouter({ file: path.join(tmp, 'none.json'), protect: s => s, unprotect: s => s, fetch: fakeFetch });
  await assert.rejects(noFetch.chat({ model: 'x/y', messages: [] }), /Add your OpenRouter key/);
  const broke = new OpenRouter({ file: path.join(tmp, 'or.json'), protect: s => 'p:' + s, unprotect: s => s.slice(2), fetch: async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'Insufficient credits' } }) }) });
  await assert.rejects(broke.chat({ model: 'x/y', messages: [] }), /out of credit/);

  // ---------- a whole study through the engine ----------
  const dataDir = path.join(tmp, 'journal');
  const events = [];
  const backend = createBackend({ dataDir, deviceDir: path.join(tmp, 'device'), tmpDir: tmp, canProtect: () => false, testTrust: true, fetch: fakeFetch, send: (...a) => events.push(a), openRouterBase: 'https://openrouter.test/api/v1' });
  const call = async (name, ...args) => { const r = await backend.call(name, args); if (!r.ok) throw new Error(r.error); return r.value; };
  await call('vault:create', 'secret123');
  const st0 = await call('study:status');
  assert.equal(st0.key, false);
  assert.equal(st0.hasPacks, true);
  await assert.rejects(call('study:generate', { ref: P }), /Add your OpenRouter key/);
  await call('study:setKey', 'sk-or-v1-goodkey1234567890');
  assert.equal((await call('study:status')).key, true);

  const pick = await call('study:pick', { kind: 'ref', text: 'Matt 11:28-30' });
  assert.equal(pick.label, 'Matthew 11:28–30');
  assert.ok(pick.passageText.includes('my burden is light'));
  await assert.rejects(call('study:pick', { kind: 'ref', text: 'Hezekiah 4:1' }), /wasn’t recognised/);
  const topic = await call('study:pick', { kind: 'topic', text: 'tiredness and rest' });
  assert.equal(topic.label, 'Matthew 11:28–30');
  assert.equal(topic.topic, 'tiredness and rest');

  const srcs = await call('study:sources', { ref: P });
  assert.ok(srcs.sources.some(s => s.author === 'Alfred Edersheim'));

  // Nothing from the journal goes anywhere without permission.
  await call('entries:save', { date: '2026-11-01', title: 'Tired', html: '<p>So tired this week. The burden of work feels heavy and I cannot rest.</p>', text: 'So tired this week. The burden of work feels heavy and I cannot rest. My soul is weary, I labor all day and need rest for my soul.' });
  assert.deepEqual(await call('study:journalMatches', { ref: P }), []);
  const entryId = (await call('entries:list'))[0].id;
  await assert.rejects(call('study:generate', { ref: P, entryIds: [entryId] }), /Let Bible study read my journal/);
  await assert.rejects(call('study:pick', { kind: 'entry', id: entryId }), /Let Bible study read my journal/);

  const before = calls.length;
  const study = await call('study:generate', { ref: P, mode: 'devotional', length: 'standard' }, 'req-1');
  const sent = calls.slice(before).filter(c => c.url.endsWith('/chat/completions'));
  assert.ok(sent.length >= 1);
  assert.ok(!JSON.stringify(sent.map(c => c.body)).includes('So tired this week'), 'no journal text was sent');
  assert.ok(events.some(e => e[0] === 'study:delta' && e[1] === 'req-1'), 'the text streams to the page');
  assert.equal(study.title, 'The yoke that fits');
  assert.ok(study.sources.length >= 1);
  assert.ok(study.md.includes('Where does rest feel least possible'), 'a yes/no question was rewritten');
  assert.ok(!study.md.includes('Do you feel tired'));
  assert.ok((await call('study:history')).length === 1);

  // With permission: matched on this device, and only what the person agreed to.
  await call('settings:set', { studyJournal: true });
  const matches = await call('study:journalMatches', { ref: P });
  assert.equal(matches.length, 1);
  assert.ok(matches[0].excerpt.includes('tired') || matches[0].excerpt.includes('rest'));
  const b2 = calls.length;
  await call('study:generate', { ref: P, mode: 'personal', entryIds: [entryId] }, 'req-2');
  assert.ok(JSON.stringify(calls.slice(b2).map(c => c.body)).includes('From 2026-11-01'), 'the chosen entry was shared');

  // Follow-up question, saved with the study.
  const ans = await call('study:ask', study.id, 'What would this have meant to its first hearers?', 'req-3');
  assert.ok(typeof ans.answer === 'string');
  assert.equal((await call('study:get', study.id)).thread.length, 2);

  // Save to the journal.
  const meta = await call('study:save', study.id, { html: '<h2>The yoke that fits</h2><p>My reflection.</p>', reflection: 'My reflection.' });
  assert.equal(meta.category, 'bible-study');
  assert.ok((await call('categories:get')).some(c => c.id === 'bible-study' && c.name === 'Bible study'));
  assert.equal((await call('study:get', study.id)).entryId, meta.id);
  const again = await call('study:save', study.id, { html: '<p>Changed.</p>' });
  assert.equal(again.id, meta.id, 'saving again updates the same entry');

  // Bookmarks and prayer list.
  const bm = await call('study:bookmark', srcs.sources[0], true);
  assert.equal(bm.length, 1);
  assert.equal((await call('study:bookmark', srcs.sources[0], false)).length, 0);
  const pr = await call('study:setPrayers', [{ id: 'p1', text: 'For Sam, starting work', at: '2026-11-19' }, { id: 'p2', text: '   ' }]);
  assert.equal(pr.length, 1);

  // Settings are checked.
  await call('settings:set', { studyModel: 'not a model', studyMode: 'nonsense', studyLength: 'extended' });
  const s = await call('settings:get');
  assert.equal(s.studyModel, '');
  assert.equal(s.studyMode, 'devotional');
  assert.equal(s.studyLength, 'extended');

  // Locking and reopening keeps it all, encrypted.
  await call('vault:lock');
  await call('vault:unlock', 'secret123');
  assert.equal((await call('study:history')).length, 2);
  assert.ok(!fs.readFileSync(path.join(dataDir, 'meta.enc')).toString('latin1').includes('yoke that fits'), 'studies are encrypted');

  await call('study:clearHistory');
  assert.equal((await call('study:history')).length, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('study tests passed');
})().catch(e => { console.error(e); process.exit(1); });
