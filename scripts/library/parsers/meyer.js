'use strict';
/**
 * F. B. Meyer, Through the Bible Day by Day (scanned): each day is "38. Woe or Welcome." then a line that opens with
 * its passage, "Matthew 11: 20-30. The voice of…". Page heads ("THROUGH THE BIBLE DAY BY DAY", "THE GOSPEL ACCORDING
 * TO MATTHEW 33") and the review questions are left out.
 */
const refs = require('../../../src/study/refs');
const { cleanOcr } = require('./common');

const TITLE = /^\s*(\d{1,3})\.\s+([A-Z‘“'"][^.]{2,70}[.?!’”]?)\s*$/;
const OPENS = /^\s*((?:[1-3I]{1,3}\s?)?[A-Z][a-z]+(?:\s(?:of|of\s[A-Z][a-z]+|[A-Z][a-z]+))?\.?\s+\d{1,3}\s?[:.]\s?\d{1,3}(?:\s?[-–]\s?(?:\d{1,3}\s?[:.]\s?)?\d{1,3})?)[.;,]?\s+(.*)$/;
const HEAD = /THROUGH THE BIBLE DAY BY DAY|^\s*[A-Z][A-Z ,.'’-]{6,}\s+\d{1,4}\s*$|^\s*\d{1,4}\s+[A-Z][A-Z ,.'’-]{6,}\s*$/;

module.exports = function parse(raw) {
  const lines = String(raw).replace(/\r/g, '').split('\n');
  const out = [];
  let cur = null;
  const close = () => {
    if (cur && cur.ref) {
      const text = cleanOcr(cur.lines.join('\n')).replace(/\(The questions[\s\S]*?\)\s*/g, '').trim();
      if (text.length > 120) out.push({ section: `${cur.title} (${refs.label(cur.ref)})`, refs: [cur.ref], text });
    }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].match(TITLE);
    if (t) {
      // A day's title is followed, within a few lines, by the line that opens with its passage.
      let j = i + 1; while (j < lines.length && j < i + 5 && !lines[j].trim()) j++;
      const o = (lines[j] || '').match(OPENS);
      const r = o && refs.parse(o[1].replace(/\s?:\s?/, ':'));
      if (r) { close(); cur = { title: t[2].replace(/\.$/, '').trim(), ref: r, lines: [o[2]] }; i = j; continue; }
    }
    if (!cur || HEAD.test(lines[i])) continue;
    if (/questions on Sections|QUESTIONS/.test(lines[i])) { close(); continue; }
    cur.lines.push(lines[i]);
  }
  close();
  return out;
};
