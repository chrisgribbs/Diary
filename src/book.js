'use strict';
/**
 * The book: an optional writing project (Settings → General → "Write a book"), kept inside the encrypted journal
 * (the vault's meta, under `book`) and synced through Google Drive as its own file, merged chapter by chapter.
 *
 *   info:     { title, subtitle, goal (words), start, due (YYYY-MM-DD), order: [chapter ids], u }
 *   chapters: [{ id, title, passage ('John 3:1-21'), outline (plain text), status, html, words, created, u }]
 *   gone:     { chapterId: when it was removed }   so a removal on one device isn't undone by another
 *   days:     { 'YYYY-MM-DD': the book's total words at the end of that day }   for the week's pace
 *
 * Phone-safe like the rest of src/: no \p{…}, normalize() or Intl.
 */
const crypto = require('crypto');

const STATUS = ['planned', 'drafting', 'revising', 'done'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T/;
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const time = v => (TIME.test(String(v || '')) ? String(v).slice(0, 30) : '');

function localISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1 + n, d);
  if (t.getDate() !== d) t.setDate(0);   // 31 Aug + 6 months → 28/29 Feb
  return localISO(t);
}

/** Plain text of a chapter's HTML (for counting and export). */
function textOf(html) {
  return String(html || '')
    .replace(/<(?:br|\/p|\/h[1-6]|\/li|\/blockquote|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
/** Words, counted the way a word processor does: runs of letters, digits and joined punctuation between spaces. */
const countWords = html => (textOf(html).match(/[^\s—–]+/g) || []).filter(w => /[A-Za-z0-9À-ɏ]/.test(w)).length;

function cleanChapter(c) {
  c = c && typeof c === 'object' ? c : {};
  const html = str(c.html, 2000000);
  return {
    id: /^[\w-]{6,64}$/.test(c.id || '') ? c.id : crypto.randomUUID(),
    title: str(c.title, 200).trim(),
    passage: str(c.passage, 120).trim(),
    outline: str(c.outline, 20000),
    status: STATUS.includes(c.status) ? c.status : 'planned',
    html,
    words: countWords(html),
    created: time(c.created) || new Date().toISOString(),
    u: time(c.u),
  };
}

function cleanBook(b) {
  b = b && typeof b === 'object' ? b : {};
  const i = b.info && typeof b.info === 'object' ? b.info : {};
  const start = ISO.test(i.start || '') ? i.start : localISO();
  const chapters = (Array.isArray(b.chapters) ? b.chapters : []).slice(0, 400).map(cleanChapter);
  const ids = new Set(chapters.map(c => c.id));
  const order = [...new Set((Array.isArray(i.order) ? i.order : []).filter(id => ids.has(id)))];
  for (const c of [...chapters].sort((x, y) => x.created.localeCompare(y.created))) if (!order.includes(c.id)) order.push(c.id);
  const gone = {};
  for (const [k, v] of Object.entries(b.gone && typeof b.gone === 'object' ? b.gone : {})) if (/^[\w-]{6,64}$/.test(k) && time(v)) gone[k] = time(v);
  const days = {};
  for (const [k, v] of Object.entries(b.days && typeof b.days === 'object' ? b.days : {})) if (ISO.test(k) && Number.isFinite(+v) && +v >= 0) days[k] = Math.round(+v);
  return {
    info: {
      title: str(i.title, 200).trim() || 'My book on John',
      subtitle: str(i.subtitle, 300).trim(),
      goal: Math.max(1000, Math.min(1000000, Math.round(+i.goal) || 50000)),
      start,
      due: ISO.test(i.due || '') && i.due > start ? i.due : addMonths(start, 6),
      order,
      u: time(i.u),
    },
    chapters, gone, days,
  };
}

const ordered = b => b.info.order.map(id => b.chapters.find(c => c.id === id)).filter(Boolean);
const total = b => b.chapters.reduce((n, c) => n + c.words, 0);

/** Progress against the goal and the due date, for the top of the Book section. */
function stats(b, today = localISO()) {
  const words = total(b), goal = b.info.goal;
  const day = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
  const span = Math.max(1, day(b.info.due) - day(b.info.start));
  const gone = Math.min(span, Math.max(0, day(today) - day(b.info.start)));
  const left = Math.max(0, day(b.info.due) - day(today));
  const expected = Math.round(goal * gone / span);
  // This week (from Monday): words now, less the total at the end of last Sunday (or the nearest day before it).
  const t = new Date(day(today) * 864e5), dow = (t.getUTCDay() + 6) % 7;
  const weekStart = new Date((day(today) - dow) * 864e5).toISOString().slice(0, 10);
  const before = Object.keys(b.days).filter(d => d < weekStart).sort().pop();
  const thisWeek = Math.max(0, words - (before ? b.days[before] : 0));
  const todayStart = Object.keys(b.days).filter(d => d < today).sort().pop();
  const todayWords = Math.max(0, words - (todayStart ? b.days[todayStart] : 0));
  const remaining = Math.max(0, goal - words);
  return {
    words, goal, percent: Math.min(100, Math.round(1000 * words / goal) / 10),
    daysLeft: left, weeksLeft: Math.round(left / 7 * 10) / 10,
    expected, ahead: words - expected,
    perDay: left ? Math.ceil(remaining / left) : remaining,
    perWeek: left ? Math.ceil(remaining / Math.max(1, left / 7)) : remaining,
    thisWeek, today: todayWords, chapters: b.chapters.length,
    done: b.chapters.filter(c => c.status === 'done').length,
  };
}

/**
 * Two devices' books, merged: each chapter's newer edit wins, a removal wins over older copies, the newer book
 * details (title, goal, dates, order) win, and each day keeps the higher total.
 */
function mergeBooks(mine, theirs) {
  const gone = { ...mine.gone };
  for (const [k, v] of Object.entries(theirs.gone)) if (!gone[k] || v > gone[k]) gone[k] = v;
  const by = new Map();
  for (const c of [...mine.chapters, ...theirs.chapters]) { const o = by.get(c.id); if (!o || c.u > o.u) by.set(c.id, c); }
  const chapters = [...by.values()].filter(c => !(gone[c.id] && gone[c.id] >= c.u));
  for (const c of chapters) delete gone[c.id];
  const info = theirs.info.u > mine.info.u ? theirs.info : mine.info;
  const days = { ...mine.days };
  for (const [d, n] of Object.entries(theirs.days)) days[d] = Math.max(days[d] || 0, n);
  return cleanBook({ info, chapters, gone, days });
}
const signature = b => JSON.stringify([b.info.u, b.chapters.map(c => c.id + c.u).sort(), Object.keys(b.gone).sort(), Object.entries(b.days).sort()]);

module.exports = { cleanBook, cleanChapter, countWords, textOf, stats, mergeBooks, signature, ordered, total, localISO, addMonths, STATUS };
