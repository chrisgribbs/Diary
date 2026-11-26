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

// ---------- library parsers, on samples shaped like the scans ----------
{
  const meyer = require('../scripts/library/parsers/meyer');
  const m = meyer(`38. Woe or Welcome.\n\n\nMatthew 11: 20-30. The voice of upbraiding, vs. 20-24.\nThe Judge weeps as he pronounces the doom of those\nwho reject him. They would have crowned him king,\nbut refused to repent. See John 6:15. These cities did\nnot crucify him.\n\n34 THROUGH THE BIBLE DAY BY DAY\n\nThe voice of pleading mercy, vs. 28-30. The invitation is to commit and submit.\n\n\n39. The Right Use of the Sabbath.\n\n\nMatthew 12: 1-14. The Pharisees had introduced a large number of minute and absurd restrictions on Sabbath observance, so our Lord set himself to recover the day.`);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].refs, [[39, 11, 20, 11, 30]]);
  assert.ok(m[0].section.startsWith('Woe or Welcome'));
  assert.ok(!m[0].text.includes('THROUGH THE BIBLE'), 'page heads are dropped');
  const hastings = require('../scripts/library/parsers/hastings');
  const body = 'THERE were several reasons which made this gracious invitation specially appropriate to the age. '.repeat(12);
  const h = hastings(`LITERATURE.\nSmith (J.), Sermons, 12.\n\n\nTHE GREAT INVITATION.\n\n\nCome unto me, all ye that labour and are heavy laden, and I will give\nyou rest.—Matt. xi. 28.\n\n\n${body}\n\nLITERATURE.\nJones (A.), More Sermons.\n\n\nSpiritual  Wrestling.\n\nAnd  Jacob  was  left  alone ;  and  there  wrestled  a  man  with  him  until  the\nbreaking  of  the  day.— Gen.  xxxii.  24.\n\n${body}`);
  assert.equal(h.length, 2, 'both heading styles are found');
  assert.deepEqual(h[0].refs, [[39, 11, 28, 11, 28]]);
  assert.deepEqual(h[1].refs, [[0, 32, 24, 32, 24]]);
  assert.ok(!h[0].text.includes('Jones'), 'the next reading list is not part of the text');
  // Maclaren (Gutenberg): a title in capitals, the quote ending "--REF", a reference wrapped onto the next line,
  // a reference alone under the quote, and a second sermon ("II") on the same passage
  const maclaren = require('../scripts/library/parsers/maclaren');
  const sermon = 'No wise teacher is ever afraid of repeating himself, and the average mind requires the reiteration of truth. '.repeat(10);
  const mac = maclaren(`*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\nCONTENTS\n\nTHE TRUE VINE\nABIDING IN LOVE\n\n\n\nTHE TRUE VINE\n\n'I am the true vine, and My Father is the husbandman.'--JOHN xv. 1.\n\n${sermon}\n\n\n\nTHE TRUE BRANCHES OF THE TRUE VINE\n\n'I am the vine, ye are the branches: herein is My Father glorified.'--JOHN\nxv. 5-8.\n\n${sermon}\n\n\n\nABIDING IN LOVE\n\n    'As the Father hath loved Me, so have I loved you.'\n    JOHN XV. 9 (R. V.).\n\n${sermon}\n\n\n\nABIDING IN LOVE\n\n\nII\n\n\n${sermon}\n\n*** END OF THE PROJECT GUTENBERG EBOOK X ***`);
  assert.deepEqual(mac.map(x => x.section), ['The True Vine (John 15:1)', 'The True Branches of the True Vine (John 15:5–8)', 'Abiding in Love (John 15:9)', 'Abiding in Love (John 15:9)'], 'every sermon found, the contents skipped');
  assert.ok(mac[0].text.startsWith("'I am the true vine"), 'a short quote leads the sermon');
  assert.equal(maclaren.anchorRef('GENESIS i. 26-ii. 3.').join(), '0,1,26,2,3');
  assert.equal(maclaren.anchorRef('GENESIS xii. 8; xiii. 3, 4, 18.').join(), '0,12,8,12,8');

  // The Expositor's Bible: CHAPTER headings with titles below, the passage printed before a chapter (Dods), the
  // volume's author on each section, and a stray "B.C. 586" never read as a chapter
  const expositors = require('../scripts/library/parsers/expositors');
  const ch = 'In the preceding section of this Epistle Paul introduced the subject which was prominent in his thoughts. '.repeat(18);
  const exp = expositors(`\n\nCHAPTER I.\n\nTHE CHURCH IN CORINTH\n\n"Paul, called to be an apostle."--1 COR. i. 1-9.\n\n${ch}\n\n_THE FOOLISHNESS OF PREACHING._\n\n     "For Christ sent me not to baptize, but to preach the gospel."--1 COR. i. 17-ii. 5.\n\n\n\nCHAPTER II.\n\n_THE FOOLISHNESS OF PREACHING._\n\n${ch}\n\nCHAPTER III.\n\nTHE EXILE (B.C. 586)\n\n${ch}\n\nCHAPTER IV.\n\nA THEME\n\n${ch} as in (xi. 2), and again (xi. 4), and in chap. xi.\n\nCHAPTER V.\n\nLAST\n\n${ch}`,
    { file: 'x.txt', source: { volumes: { 'x.txt': [45] }, authors: { 'x.txt': 'Marcus Dods' } } });
  assert.deepEqual(exp.map(x => x.section), ['Marcus Dods: The Church in Corinth (1 Corinthians 1:1–9)', 'Marcus Dods: The Foolishness of Preaching (1 Corinthians 1:17–2:5)',
    'Marcus Dods: The Exile (B.C. 586)', 'Marcus Dods: A Theme (1 Corinthians 11)', 'Marcus Dods: Last']);
  assert.ok(!exp[0].text.includes('baptize'), 'the next chapter’s passage is not part of this one');

  // The keyword index has no prototype: "constructor" is just a word
  const { keysFor } = require('../scripts/library/pack');
  assert.deepEqual(keysFor(['the constructor of the toString method', 'another passage entirely']).terms.constructor, [0]);

  const chapters = require('../scripts/library/parsers/chapters');
  const para = 'The soul that would find God must first find itself, and walk in quietness. '.repeat(25);
  const c = chapters(`CONTENTS\nChapter I. Of the soul . . . . 3\nChapter II. Of prayer . . . . 9\n\nBOOK I.\n\nCHAPTER I.\n\nOf the soul\n\n${para}\n\nCHAPTER II.\n\nOf prayer\n\n${para}\n\nBOOK II.\n\nCHAPTER I.\n\nOf rest\n\n${para}`, { source: { part: '^BOOK\\s+[IVX]+\\.?$' } });
  assert.deepEqual(c.map(x => x.section), ['Book I, Chapter I: Of the soul', 'Book I, Chapter II: Of prayer', 'Book II, Chapter I: Of rest']);
  // Tyndale Open Resources: Tyndale's own zip of XML, notes grouped by chapter, dictionary tagged only with a few verses.
  const tyndale = require('../scripts/library/parsers/tyndale');
  assert.deepEqual(tyndale.osisRef('Matt.11.28-30'), [39, 11, 28, 11, 30]);
  assert.deepEqual(tyndale.osisRef('Gen.1.1-2.3'), [0, 1, 1, 2, 3]);
  assert.deepEqual(tyndale.osisRef('1Jn.4.18'), [61, 4, 18, 4, 18]);
  assert.equal(tyndale.osisRef('Xyz.1.1'), null);
  assert.equal(tyndale.textOf('<p class="sn-text"><span class="sn-ref"><a href="?bref=Matt.11.28">11:28</a></span> <span class="sn-excerpt">Come to me</span> &amp; rest.</p>'), '11:28 Come to me & rest.');
  const zipOf = entries => {   // a plain zip (stored, not compressed), enough for the parser's reader
    const parts = [], central = []; let off = 0;
    for (const [name, text] of Object.entries(entries)) {
      const data = Buffer.from(text), nm = Buffer.from(name), crc = require('zlib').crc32(data);
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
      parts.push(h, nm, data); central.push(c, nm); off += 30 + nm.length + data.length;
    }
    const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(central.length / 2, 8); e.writeUInt16LE(central.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cd, e]);
  };
  const note = (r, t) => `<item name="${r}" typename="StudyNote" product="TyndaleOpenStudyNotes"><refs>${r}</refs><body><p class="sn-text">${t}</p></body></item>`;
  const tn = tyndale(zipOf({ 'Tyndale Open Study Notes/StudyNotes.xml': `<items>${note('Matt.11.28', 'Come to me: an invitation.')}${note('Matt.11.29', 'yoke: a wooden frame.')}${note('Matt.12.1', 'Sabbath.')}</items>` }), { source: { kind: 'notes' } });
  assert.deepEqual(tn.map(x => x.section), ['Notes on Matthew 11:28–29', 'Notes on Matthew 12:1'], 'notes grouped by chapter');
  assert.equal(tn[0].text, 'Come to me: an invitation.\n\nyoke: a wooden frame.');
  const art = (n, cites) => `<item typename="Article" name="${n}_Article_TyndaleOpenBibleDictionary"><title>${n}</title><body><p class="h1">${n.toUpperCase()}</p><p class="fl">${'A place of some importance in the Bible. '.repeat(4)}${cites.map(c => `<a href="?bref=${c}">x</a>`).join(' ')}</p></body></item>`;
  const td = tyndale(zipOf({ 'Articles/M.xml': `<items>${art('Magdala', ['Matt.15.39'])}${art('Moses', ['Exod.2.1', 'Exod.3.1', 'Num.12.3', 'Deut.34.5', 'Heb.11.23'])}</items>` }), { source: { kind: 'dictionary' } });
  assert.deepEqual(td.map(x => [x.section, x.refs.length]), [['Magdala', 1], ['Moses', 0]], 'a long survey is found by meaning, not every verse it cites');
  assert.ok(td[0].text.startsWith('Magdala\n\nA place'));

  const vincent = require('../scripts/library/parsers/verse-notes-ocr');
  const v = vincent(`VOLUME I.\n\nTHE GOSPEL ACCORDING TO MATTHEW.\n\nCHAPTER XI.\n\n2. Two of his disciples (6vo). But the correct reading is by. He sent by his disciples.\n\n3. Thou. Emphatic. Art thou the Coming One, a current phrase for the Messiah.\n\n64 WORD STUDIES IN THE NEW TESTAMENT. [Cu. XI.\n\n5. The lame walk. Tyndale, the halt go; the blind receive their sight.`, { file: 'v1', source: { volumes: { v1: [39] } } });
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].refs, [[39, 11, 2, 11, 5]]);
  assert.ok(!v[0].text.includes('WORD STUDIES'), 'running heads are dropped');
}

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
  // Written for readers today: no remarks on what's missing, no apologies for old sources.
  assert.ok(msgs[0].content.includes('FOR READERS TODAY') && /Don't tell the reader what you don't know/.test(msgs[0].content));
  assert.ok(!/If you are unsure, say so|none of the sources here comments|say so briefly/.test(msgs[0].content));
  assert.ok(!/say so rather than guessing/.test(prompts.askMessages({ ref: 'x', passageText: 'y', mode: 'devotional' }, [], 'q', [])[1].content));
  // Teaching Study: its own teacher's voice and a numbered "What the passage teaches", still no writer named.
  const tm = prompts.studyMessages({ ref: 'Matthew 11:28-30', passageText: 'Come to me…', mode: 'teaching', length: 'standard' }, []);
  assert.ok(tm[1].content.includes('## What the passage teaches') && tm[1].content.includes('(i), (ii), (iii)') && tm[1].content.includes('first hearers'));
  assert.ok(!/Barclay/.test(tm[0].content + tm[1].content), 'the teaching voice is described, not borrowed');
  assert.ok(!msgs[1].content.includes('gifted teacher'), 'other modes keep the reflective voice');
  assert.ok(prompts.askMessages({ ref: 'Matthew 11:28-30', passageText: 'x', mode: 'teaching' }, [], 'Why a yoke?', [])[1].content.includes('teacher of this study'));
  // Barclay is linked, never fetched: New Testament chapters only.
  const refs = require('../src/study/refs');
  assert.equal(refs.barclayLink(refs.parse('1 Corinthians 13:4-7')).url, 'https://www.studylight.org/commentaries/eng/dsb/1-corinthians-13.html');
  assert.equal(refs.barclayLink(refs.parse('Matthew 11:28-30')).label, 'Matthew 11');
  assert.equal(refs.barclayLink(refs.parse('Psalm 23')), null);
  assert.equal(refs.barclayLink(null), null);

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
  assert.deepEqual(calls[calls.length - 1].body.reasoning, { effort: 'low', exclude: true }, 'thinking models are asked to think lightly, so the answer gets the words');
  assert.equal(res.cut, false, 'a finished answer is not marked cut');
  assert.ok(prompts.LENGTHS.short.maxTokens >= 12000 && prompts.THINKING === 'high', 'studies get room to think and to write');
  assert.equal(or.month().requests, 1);
  assert.ok(Math.abs(or.month().usd - 0.0012) < 1e-9);
  // An answer that runs out of words, and a stream that ends without [DONE], are both marked cut.
  const sse = lines => { const enc = new TextEncoder(); const b = lines.map(l => enc.encode(l)); let i = 0; return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < b.length ? { done: false, value: b[i++] } : { done: true }) }) } }; };
  const ran = new OpenRouter({ file: path.join(tmp, 'or.json'), protect: s => 'p:' + s, unprotect: s => s.slice(2), usageFile: path.join(tmp, 'u2.json'),
    fetch: async () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'The psalm complains about a' }, finish_reason: 'length' }] })}\n\n`, 'data: [DONE]\n\n']) });
  assert.equal((await ran.chat({ model: 'x/y', messages: [], onDelta: () => {} })).cut, true, 'finish_reason length is cut');
  const lost = new OpenRouter({ file: path.join(tmp, 'or.json'), protect: s => 'p:' + s, unprotect: s => s.slice(2), usageFile: path.join(tmp, 'u3.json'),
    fetch: async () => sse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'The psalm complains about a' } }] })}\n\n`]) });
  assert.equal((await lost.chat({ model: 'x/y', messages: [], onDelta: () => {} })).cut, true, 'a stream with no ending is cut');
  const plain = new OpenRouter({ file: path.join(tmp, 'or.json'), protect: s => 'p:' + s, unprotect: s => s.slice(2), usageFile: path.join(tmp, 'u4.json'),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'half' }, finish_reason: 'length' }], usage: {} }) }) });
  assert.equal((await plain.chat({ model: 'x/y', messages: [] })).cut, true, 'cut without streaming too');
  // A connection that never answers: Save gives up and says so, rather than waiting for ever.
  const hung = new OpenRouter({ file: path.join(tmp, 'hung.json'), protect: s => s, unprotect: s => s, fetch: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) });
  hung.keyTimeout = 50;
  await assert.rejects(hung.setKey('sk-or-v1-goodkey1234567890'), /didn’t answer within 20 seconds/);
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

  // The key travels with the journal: another device opening the same (synced) journal has it without typing it.
  const other = createBackend({ dataDir, deviceDir: path.join(tmp, 'device2'), tmpDir: tmp, canProtect: () => false, testTrust: true, fetch: fakeFetch, send: () => {}, openRouterBase: 'https://openrouter.test/api/v1' });
  const call2 = async (name, ...args) => { const r = await other.call(name, args); if (!r.ok) throw new Error(r.error); return r.value; };
  await call2('vault:unlock', 'secret123');
  assert.equal((await call2('study:status')).key, true, 'a second device picks up the key from the journal');
  // A device that had a key before keys were synced shares it the first time.
  const oldDir = path.join(tmp, 'journal-old'), oldDev = path.join(tmp, 'device-old');
  fs.mkdirSync(oldDev, { recursive: true });
  fs.copyFileSync(path.join(tmp, 'device', 'openrouter.json'), path.join(oldDev, 'openrouter.json'));
  const old = createBackend({ dataDir: oldDir, deviceDir: oldDev, tmpDir: tmp, canProtect: () => false, testTrust: true, fetch: fakeFetch, send: () => {}, openRouterBase: 'https://openrouter.test/api/v1' });
  const callOld = async (name, ...args) => { const r = await old.call(name, args); if (!r.ok) throw new Error(r.error); return r.value; };
  await callOld('vault:create', 'secret123');
  const { Vault } = require('../src/vault');
  const peek = new Vault(oldDir); peek.unlock('secret123');
  assert.equal(peek.getStudy().aiKey.k, 'sk-or-v1-goodkey1234567890', 'an existing key is put in the journal when it opens, without visiting Bible study');
  assert.equal((await callOld('study:status')).key, true);
  // Removing it on one device removes it on the others.
  await call2('study:forgetKey');
  assert.equal((await call2('study:status')).key, false);
  assert.equal((await call('study:status')).key, false, 'removed everywhere');
  await call('study:setKey', 'sk-or-v1-goodkey1234567890');
  assert.equal((await call2('study:status')).key, true, 'and adding it again reaches the others');

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

  // From an entry: only the excerpt the person saw is sent, never the whole entry.
  await assert.rejects(call('study:pick', { kind: 'entry', id: entryId }), /Choose the words to share/);
  const ex = await call('study:entryExcerpt', entryId);
  assert.ok(ex.excerpt.startsWith('So tired this week'));
  const b3 = calls.length;
  const fromEntry = await call('study:pick', { kind: 'entry', id: entryId, excerpt: 'So tired this week.' });
  assert.deepEqual(fromEntry.entryIds, [entryId]);
  const sentNow = JSON.stringify(calls.slice(b3).map(c => c.body));
  assert.ok(sentNow.includes('So tired this week.') && !sentNow.includes('need rest for my soul'), 'only the chosen words were sent');
  await assert.rejects(call('study:pick', { kind: 'entry', id: entryId, excerpt: 'Words that are not in the entry at all.' }), /Choose the words/);

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
