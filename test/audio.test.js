'use strict';
// The Bible read aloud (src/audio/web-henson.json): a recording for every chapter, all on eBible.org.
const assert = require('assert');
const a = require('../src/audio/web-henson.json');
const books = require('../src/bible').books('web');
assert.equal(a.base, 'https://ebible.org/eng-web/audio/');
assert.equal(a.files.length, 66);
books.forEach((b, i) => assert.equal(a.files[i].length, b.chapters, `${b.name}: ${a.files[i].length} files for ${b.chapters} chapters`));
const all = a.files.flat();
assert.equal(all.length, 1189);
assert.equal(new Set(all).size, 1189, 'every chapter its own file');
for (const f of all) assert(/^\d\d_[A-Za-z_]+\/[^/]+\.mp3$/.test(f) && !/[\s"'<>]/.test(f), 'a plain, encoded path: ' + f);
// Spot checks, by the words in the file names
const name = (b, c) => decodeURIComponent(a.files[b][c - 1]);
assert.match(name(0, 1), /Genesis_Chapter_One/);
assert.match(name(18, 23), /Psalms-Twenty Three\.mp3$/);
assert.match(name(18, 119), /Psalms-One Hundred Nineteen\.mp3$/);
assert.match(name(19, 31), /Proverbs-Chapter 031/);
assert.match(name(42, 3), /John-Chapter Three\.mp3$/);
assert.match(name(43, 13), /Acts-Chapter Thirteen/);
assert.match(name(65, 22), /Revelation.*Twenty Two/);
assert(!/\(1\)/.test(name(18, 71)) && !/\(1\)/.test(name(41, 17)), 'the originals, not the copies');
assert(/public domain/i.test(a.credit) && /Henson/.test(a.name));

// The engine hands out a chapter's address, and nothing for chapters that don't exist.
const { createBackend } = require('../src/backend');
const os = require('os'), fs = require('fs'), path = require('path');
const { handlers: h } = createBackend({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ww-audio-')), send: () => {}, secret: { get: () => null, set: () => {} } });
const handlers = Object.fromEntries(h);
(async () => {
  const r = await handlers['bible:audio'](42, 3);
  assert.equal(r.url, a.base + a.files[42][2]);
  assert.equal(await handlers['bible:audio'](42, 22), null);
  assert.equal(await handlers['bible:audio'](99, 1), null);
  assert.equal(await handlers['bible:audio']('x', 1), null);
  console.log('audio tests passed');
})().catch(e => { console.error(e); process.exit(1); });
