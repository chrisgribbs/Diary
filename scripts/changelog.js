'use strict';
// Writes CHANGELOG.md from renderer/changelog.js (the list shown in Settings → What's new).
// Run: npm run changelog
const fs = require('fs'), path = require('path');
const list = require('../renderer/changelog.js');
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
function markdown() {
  const out = ['# What’s new in WellWrite', '', 'Every version, newest first. The same list is in the app under Settings → What’s new.', ''];
  for (const r of list) {
    out.push(`## ${r.v} — ${r.title}`, `_${fmt(r.date)}_`, '');
    for (const [k, label] of [['new', 'New'], ['improved', 'Improved'], ['fixed', 'Fixed']]) {
      if (!r[k] || !r[k].length) continue;
      out.push(`**${label}**`, '', ...r[k].map(x => '- ' + x), '');
    }
  }
  return out.join('\n');
}
module.exports = { markdown };
if (require.main === module) { fs.writeFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), markdown()); console.log('CHANGELOG.md written'); }
