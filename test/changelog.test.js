'use strict';
// The What's new list covers the current version, is newest first, and CHANGELOG.md matches it.
const assert = require('assert'), fs = require('fs'), path = require('path');
const list = require('../renderer/changelog.js');
const { markdown } = require('../scripts/changelog.js');
const pkg = require('../package.json');
assert.equal(list[0].v, pkg.version, 'What’s new has an entry for this version (add it to renderer/changelog.js)');
const n = v => v.split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
for (let i = 1; i < list.length; i++) {
  assert.ok(n(list[i - 1].v) > n(list[i].v), `newest first: ${list[i - 1].v} before ${list[i].v}`);
  assert.ok(list[i - 1].date >= list[i].date, `dates in order at ${list[i].v}`);
}
for (const r of list) {
  assert.match(r.date, /^\d{4}-\d\d-\d\d$/); assert.ok(r.title);
  assert.ok(['new', 'improved', 'fixed'].some(k => (r[k] || []).length), `${r.v} says what changed`);
}
assert.equal(fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n'), markdown(), 'CHANGELOG.md is up to date (npm run changelog)');
console.log('changelog tests passed:', list.length, 'versions');
