'use strict';
// The book (src/book.js): words, the goal and its pace, merging two devices' copies, and the Word export.
// Run: node test/book.test.js
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const Book = require('../src/book');
const { Vault } = require('../src/vault');

// Words, as a word processor counts them
assert.equal(Book.countWords('<p>In the beginning was the Word.</p><p>And the Word was with God&nbsp;— and was God.</p>'), 15);
assert.equal(Book.countWords('<p>don’t, well-known 3:16</p>'), 3);
assert.equal(Book.countWords(''), 0);

// A new book: 50,000 words, six months from today
const b = Book.cleanBook({ info: { start: '2026-11-21' } });
assert.equal(b.info.goal, 50000);
assert.equal(b.info.due, '2027-05-21');
assert.equal(b.info.title, 'My book on John');
assert.equal(Book.addMonths('2026-08-31', 6), '2027-02-28', 'month ends');

// Pace: halfway through the time with a quarter written is behind; the week's words count from Monday
const half = Book.cleanBook({ info: { start: '2026-01-01', due: '2026-07-01', goal: 50000 },
  chapters: [{ id: 'chapter-1', title: 'One', html: '<p>' + 'word '.repeat(12500) + '</p>' }],
  days: { '2026-03-29': 11000, '2026-03-31': 12000 } });
const st = Book.stats(half, '2026-04-01');   // a Wednesday; Monday was 30 March
assert.equal(st.words, 12500);
assert.equal(st.percent, 25);
assert.ok(st.ahead < -10000, 'behind the line from start to due date');
assert.equal(st.thisWeek, 1500, 'since the end of Sunday 29 March');
assert.equal(st.today, 500, 'since the end of yesterday');
assert.equal(st.perDay, Math.ceil(37500 / 91));

// Stored in the encrypted journal: a chapter's text never appears in the files on disk
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-book-'));
const v = new Vault(dir); v.create('river-stone');
v.updateBook(bk => { bk.chapters.push(Book.cleanChapter({ title: 'Come and see', passage: 'John 1:35-51', html: '<p>Come and see, said Philip.</p>' })); });
const onDisk = fs.readdirSync(dir).map(f => { try { return fs.readFileSync(path.join(dir, f)).toString('latin1'); } catch { return ''; } }).join('');
assert.ok(!onDisk.includes('Philip'), 'encrypted at rest');
const saved = v.getBook();
assert.equal(saved.chapters[0].words, 5);
assert.ok(saved.chapters[0].u, 'stamped');
assert.equal(saved.days[Book.localISO()], 5, 'today’s total noted');
assert.ok(v.bookForSync().updated, 'marked for sync');
// An unchanged chapter keeps its time
const u = saved.chapters[0].u;
v.updateBook(bk => { bk.info.subtitle = 'Reflections'; });
assert.equal(v.getBook().chapters[0].u, u);
assert.ok(v.getBook().info.u, 'details stamped');

// Word export (src/docx.js)
const { bookDocx } = require('../src/docx');
const docx = bookDocx(v.getBook());
assert.equal(docx.slice(0, 2).toString(), 'PK', 'a zip');
const { unzip } = require('../scripts/library/parsers/common');
const files = unzip(docx);
for (const f of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml']) assert.ok(files[f], f);
const xml = files['word/document.xml'].toString();
assert.match(xml, /Come and see, said Philip\./);
assert.match(xml, /<w:pStyle w:val="Heading1"\/>[\s\S]*Come and see/, 'chapter heading');
assert.match(xml, /My book on John/);
fs.rmSync(dir, { recursive: true, force: true });
console.log('book tests passed');
