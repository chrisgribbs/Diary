'use strict';
// The engine must run on the Android app's Node.js, which is built without Unicode (ICU) tables. There:
//   - a regular expression with \p{…} or \P{…} doesn't even load: it stopped WellWrite 1.33.0 opening on phones;
//   - String.normalize() quietly does nothing, and Intl formats in a plain default way.
// Windows (and these tests) have the tables, so nothing else would notice. This reads the engine's code for them.
// Run: node test/engine-portable.test.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const files = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p); } };
walk(path.join(ROOT, 'src')); files.push(path.join(ROOT, 'android', 'node', 'main.js'));
// Known and fine: the password's NFKC (the same on every device for ordinary passwords; noted in vault.js).
const ALLOWED = [/String\(password\)\.normalize\('NFKC'\)/];
const problems = [];
for (const f of files) {
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {   // (Windows checks out files with CRLF)
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');   // not comments
    if (ALLOWED.some(r => r.test(code))) return;
    if (/\\[pP]\{/.test(code)) problems.push(`${path.relative(ROOT, f)}:${i + 1}  \\p{…} in a regular expression (won't load on Android)`);
    if (/\.normalize\(/.test(code)) problems.push(`${path.relative(ROOT, f)}:${i + 1}  normalize() (does nothing on Android: use src/study/text.js deaccent)`);
    if (/\bIntl\./.test(code)) problems.push(`${path.relative(ROOT, f)}:${i + 1}  Intl (no locale data on Android)`);
  });
}
assert.deepEqual(problems, [], 'engine code that needs Unicode tables:\n  ' + problems.join('\n  '));
// And the engine's modules load (a regular expression that can't compile fails here, on every Node).
for (const f of files.filter(f => !/android/.test(f))) require(f);
// The accent helper matches the full tables for every letter it knows (Latin, Greek, Cyrillic).
const { deaccent } = require('../src/study/text');
for (const [a, b] of [[0xC0, 0x24F], [0x370, 0x3FF], [0x1E00, 0x1EFF], [0x1F00, 0x1FFF], [0x400, 0x4FF]]) {
  for (let c = a; c <= b; c++) {
    const ch = String.fromCharCode(c), want = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    assert.equal(deaccent(ch), want, `deaccent(${ch}) U+${c.toString(16)}`);
  }
}
console.log('engine portable tests passed');
