'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { ApiBible, parseRef, toBlocks, blocksToText, CODES } = require('../src/apibible');
const { BOOKS } = require('../src/bible-books');

assert.equal(CODES.length, BOOKS.length);
assert.deepEqual(parseRef('Psalms 130:5-6').passageId, 'PSA.130.5-PSA.130.6');
assert.equal(parseRef('Jude 1:24-25').passageId, 'JUD.1.24-JUD.1.25');
assert.equal(parseRef('Song of Solomon 2:11-12').passageId, 'SNG.2.11-SNG.2.12');
assert.equal(parseRef('1 John 4:19').passageId, '1JN.4.19-1JN.4.19');
assert.equal(parseRef('Nonsense 1:1'), null);

// API.Bible "json" content: paragraphs with styles, verse markers, text with verseId, notes, words of Jesus
const T = (text, vid) => ({ text, type: 'text', attrs: { verseId: vid } });
const sample = [
  { name: 'para', type: 'tag', attrs: { style: 's1' }, items: [{ text: 'Out of the depths', type: 'text' }] },
  { name: 'para', type: 'tag', attrs: { style: 'q1' }, items: [{ name: 'verse', type: 'tag', attrs: { number: '5', style: 'v' }, items: [{ text: '5', type: 'text' }] }, T('I wait for the Lord, my soul waits,', 'PSA.130.5')] },
  { name: 'para', type: 'tag', attrs: { style: 'q2' }, items: [T('and in his word I hope;', 'PSA.130.5'), { name: 'note', type: 'tag', attrs: { style: 'f' }, items: [{ text: 'a footnote', type: 'text' }] }] },
  { name: 'para', type: 'tag', attrs: { style: 'p' }, items: [T('Then Jesus said, ', 'MAT.11.28'), { name: 'char', type: 'tag', attrs: { style: 'wj' }, items: [T('“Come to me.”', 'MAT.11.28')] }, T(' And they came.', 'MAT.11.29')] },
];
const blocks = toBlocks(sample);
assert.deepEqual(blocks, [
  ['h', 'Out of the depths'],
  ['q', [[5, 'I wait for the Lord, my soul waits,'], [5, 'and in his word I hope;']]],
  ['p', [[28, 'Then Jesus said, “Come to me.”'], [29, 'And they came.']]],
]);
assert.equal(blocksToText(blocks), 'I wait for the Lord, my soul waits,\nand in his word I hope; Then Jesus said, “Come to me.” And they came.');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-apib-'));
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url, key: opts.headers && opts.headers['api-key'] });
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (url.startsWith('https://fums.api.bible/')) return ok({});
    if (opts.headers['api-key'] !== 'good-key-123') return { ok: false, status: 401, json: async () => ({}) };
    if (url.includes('/bibles?language=eng')) return ok({ data: [{ id: 'de4e12af7f28f599-02', name: 'King James (Authorised) Version', abbreviationLocal: 'KJV', language: { name: 'English' } }, { id: '9879dbb7cfe39e4d-04', name: 'World English Bible', abbreviation: 'WEB', language: { name: 'English' } }] });
    if (url.includes('/passages/PSA.130.5-PSA.130.6')) return ok({ data: { content: sample.slice(1, 3), copyright: '<p>Public domain</p>' }, meta: { fumsToken: 'tok1' } });
    if (url.includes('/chapters/PSA.130')) return ok({ data: { content: sample, copyright: 'PD' }, meta: { fumsToken: 'tok2' } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const ab = new ApiBible({ file: path.join(tmp, 'apibible.json'), protect: s => 'enc:' + Buffer.from(s).toString('base64'), unprotect: s => Buffer.from(s.slice(4), 'base64').toString(), fetch: fakeFetch });
  assert.equal(ab.status().connected, false);
  await assert.rejects(() => ab.setKey('bad-key-999'), /didn’t accept/);
  await assert.rejects(() => ab.setKey('x'), /doesn’t look like/);
  assert.equal((await ab.setKey('good-key-123')).connected, true);
  assert.ok(!fs.readFileSync(path.join(tmp, 'apibible.json'), 'utf8').includes('good-key-123'), 'key not stored in plain text');
  const list = await ab.list('eng');
  assert.deepEqual(list.map(b => b.abbr), ['KJV', 'WEB']);
  ab.setVersions([list[0], { id: '../etc' }]);
  assert.deepEqual(ab.versions().map(v => v.id), ['de4e12af7f28f599-02']);
  const p = await ab.passage('de4e12af7f28f599-02', 'Psalms 130:5-6');
  assert.deepEqual(p, { ref: 'Psalm 130:5-6', text: 'I wait for the Lord, my soul waits,\nand in his word I hope;', translation: 'KJV', copyright: 'Public domain' });
  await new Promise(r => setTimeout(r, 20));
  assert.ok(calls.some(c => c.url.startsWith('https://fums.api.bible/f3?t=tok1&dId=') && c.url.includes('&sId=')), 'fair-use reported');
  const before = calls.filter(c => c.url.includes('/passages/')).length;
  await ab.passage('de4e12af7f28f599-02', 'Psalms 130:5-6');
  assert.equal(calls.filter(c => c.url.includes('/passages/')).length, before, 'held in memory for the session');
  const ch = await ab.chapter('de4e12af7f28f599-02', 18, 130);
  assert.equal(ch.blocks[0][0], 'h');
  await assert.rejects(() => ab.passage('../x', 'Psalms 1:1'), /Unknown/);
  assert.equal(ab.forget().connected, false);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('API.Bible tests passed');
})().catch(e => { console.error(e); process.exit(1); });
