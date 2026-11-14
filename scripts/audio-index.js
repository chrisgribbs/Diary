// Builds src/audio/web-henson.json from a listing of ebible.org/eng-web/audio (book folder <tab> file name per line).
// Usage: node scripts/audio-index.js files.tsv src/audio/web-henson.json
const fs = require('fs');
const [tsv, out] = process.argv.slice(2);
const books = require('../src/bible').books('web');
const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const words = s => { let n = 0; for (const w of s.toLowerCase().split(/[\s_-]+/).filter(Boolean)) { if (w === 'hundred') n = (n || 1) * 100; else if (w === 'and') {} else if (TENS[w]) n += TENS[w]; else if (ONES.includes(w)) n += ONES.indexOf(w); else return NaN; } return n; };
const rows = fs.readFileSync(tsv, 'utf8').trim().split('\n').map(l => l.split('\t'));
const by = {}; for (const [d, f] of rows) (by[d] = by[d] || []).push(f);
const dirs = Object.keys(by).sort();
const files = [], problems = [];
dirs.forEach((d, bi) => {
  const want = books[bi].chapters, ch = Array(want).fill(null);
  for (const f of by[d]) {
    const name = decodeURIComponent(f).replace(/\.mp3$/i, '');
    // "Chapter Three", "Chapter_Three", "Psalms-Twenty Three", "Chapter 001"; a copy is "… (1)", and Acts 13 is "Thirteen 1"
    const copy = /\s\(\d+\)$/.test(name);
    const m = name.replace(/\s\(\d+\)$/, '').replace(/([A-Za-z])\s+1$/, '$1').match(/(?:Chapter[ _]|Psalms-)([A-Za-z _]+|\d+)$/);
    const n = !m ? NaN : /^\d+$/.test(m[1]) ? +m[1] : words(m[1]);
    if (copy && ch[n - 1]) continue;   // a second copy of a chapter we have
    if (!(n >= 1 && n <= want)) { problems.push(`${d} ${name}: not a chapter`); continue; }
    if (ch[n - 1] && /\s\(\d+\)\.mp3$/i.test(decodeURIComponent(ch[n - 1]))) { ch[n - 1] = d + f; continue; }   // the original over a copy
    if (ch[n - 1]) { problems.push(`${d} ${name}: second file for chapter ${n} (keeping ${decodeURIComponent(ch[n - 1])})`); continue; }
    ch[n - 1] = d + f;
  }
  ch.forEach((x, i) => { if (!x) problems.push(`${books[bi].name} ${i + 1}: missing`); });
  files.push(ch);
});
console.log(problems.join('\n') || 'every chapter has one file');
fs.writeFileSync(out, JSON.stringify({
  name: 'World English Bible, read by Winfred Henson',
  credit: 'Audio: the World English Bible read by Winfred W. Henson, from eBible.org (ebible.org/eng-web/audio). The World English Bible text is public domain.',
  base: 'https://ebible.org/eng-web/audio/',
  files,
}) + '\n');
