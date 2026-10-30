'use strict';
// Builds the bundled Bible texts (both public domain) into a compact format:
//   bible/web.json  World English Bible   (from the `world-english-bible` npm package)
//   bible/kjv.json  King James Version 1769 (from the `kjv` npm package)
// Usage: node scripts/build-bible.js <path to world-english-bible package> <path to kjv package>
//
// Output: { id, name, books: [{ name, chapters: [[block, ...], ...] }] }
//   block = ['p', [[verse, text], ...]]   prose paragraph
//         | ['q', [[verse, text], ...]]   poetry, one line each
//         | ['h', text]                   heading (e.g. a psalm title)
const fs = require('fs');
const path = require('path');
const { BOOKS } = require('../src/bible-books');

const [webDir, kjvDir] = process.argv.slice(2);
if (!webDir || !kjvDir) { console.error('usage: build-bible.js <web pkg dir> <kjv pkg dir>'); process.exit(1); }
const clean = s => String(s).replace(/\s+/g, ' ').trim();
const outDir = path.join(__dirname, '..', 'bible');

// ---- World English Bible
function buildWeb() {
  const books = BOOKS.map(b => {
    const items = JSON.parse(fs.readFileSync(path.join(webDir, 'json', b.web + '.json'), 'utf8'));
    const chapters = [];
    let block = null, chapter = 0, pendingHeads = [];
    const ch = n => { while (chapters.length < n) chapters.push([]); return chapters[n - 1]; };
    const push = () => { if (block && block[1].length) ch(chapter).push(block); block = null; };
    for (const it of items) {
      if (it.chapterNumber && it.chapterNumber !== chapter && block) { push(); }
      if (it.chapterNumber) chapter = it.chapterNumber;
      switch (it.type) {
        case 'paragraph start': push(); block = ['p', []]; break;
        case 'stanza start': push(); block = ['q', []]; break;
        case 'paragraph end': case 'stanza end': push(); break;
        // Headings (psalm titles) come before the chapter's first verse; hold them until we know where they go.
        case 'header': push(); pendingHeads.push(['h', clean(it.value)]); break;
        case 'paragraph text': case 'line text': {
          if (pendingHeads.length) { ch(chapter).push(...pendingHeads); pendingHeads = []; }
          if (!block) block = [it.type === 'line text' ? 'q' : 'p', []];
          const t = clean(it.value);
          if (!t) break;
          const last = block[1][block[1].length - 1];
          // Prose: join pieces of the same verse. Poetry: keep each line separate.
          if (block[0] === 'p' && last && last[0] === it.verseNumber) last[1] += ' ' + t;
          else block[1].push([it.verseNumber, t]);
          break;
        }
        default: break; // line breaks are implied by poetry lines
      }
    }
    push();
    return { name: b.name, chapters };
  });
  return { id: 'web', name: 'World English Bible', short: 'WEB', books };
}

// ---- King James Version (1769)
function buildKjv() {
  const verses = JSON.parse(fs.readFileSync(path.join(kjvDir, 'json', 'verses-1769.json'), 'utf8'));
  const byBook = new Map();
  for (const [ref, raw] of Object.entries(verses)) {
    const m = ref.match(/^(.*) (\d+):(\d+)$/);
    const [, book, c, v] = m;
    if (!byBook.has(book)) byBook.set(book, []);
    byBook.get(book).push([+c, +v, raw]);
  }
  const books = BOOKS.map(b => {
    const rows = byBook.get(b.kjv);
    if (!rows) throw new Error('KJV missing ' + b.kjv);
    const chapters = [];
    for (const [c, v, raw] of rows) {
      while (chapters.length < c) chapters.push([]);
      const blocks = chapters[c - 1];
      const startsPara = raw.startsWith('#') || !blocks.length;
      const text = clean(raw.replace(/^#\s*/, '').replace(/[\[\]]/g, ''));
      if (startsPara) blocks.push(['p', []]);
      blocks[blocks.length - 1][1].push([v, text]);
    }
    return { name: b.name, chapters };
  });
  return { id: 'kjv', name: 'King James Version', short: 'KJV', books };
}

fs.mkdirSync(outDir, { recursive: true });
for (const t of [buildWeb(), buildKjv()]) {
  const file = path.join(outDir, t.id + '.json');
  fs.writeFileSync(file, JSON.stringify(t));
  const chapters = t.books.reduce((a, b) => a + b.chapters.length, 0);
  const versesN = t.books.reduce((a, b) => a + b.chapters.reduce((x, c) => x + new Set(c.flatMap(bl => bl[0] === 'h' ? [] : bl[1].map(s => s[0]))).size, 0), 0);
  console.log(`${t.id}: ${t.books.length} books, ${chapters} chapters, ${versesN} verses, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}
