'use strict';
/**
 * Checks on what the AI wrote, before anyone sees it.
 *
 *  1. Quotations: anything in quotation marks (four words or more) must appear word for word in a source it was
 *     given, in the passage, in the World English Bible, or in the reader's own journal excerpts. If not, the
 *     quotation marks come off (the words stay, as paraphrase) and it's noted.
 *  2. Greek and Hebrew: every word in Greek or Hebrew letters, and every word put in italics in the word-study
 *     part, must appear in at least one source given. If not, "(not found in the sources)" follows it.
 *  3. Source labels: [S4] when only three sources were sent is removed.
 *  4. Journal questions: each is checked against the rules (one sentence, open, no "Do you…", no stock phrases).
 *     The caller asks once for better ones if any fail.
 */
const { PARTS } = require('./prompts');

// Letters only, lower case, no accents, Greek final sigma made ordinary, quotes and dashes made plain.
// (Not normalize() or \p{L}: the Android engine has no Unicode tables; see text.js.)
const { deaccent, NOT_WORD } = require('./text');
const flat = s => deaccent(s).toLowerCase()
  .replace(/ς/g, 'σ').replace(/[‘’`´]/g, "'").replace(/[“”«»„]/g, '"').replace(NOT_WORD, ' ').trim();

const STOCK = ['lean into', 'journey', 'unpack', 'hold space', 'season of life', 'in this space', 'tapestry', 'delve', 'let go and let god', 'god-sized'];

function sectionOf(md, heading) {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi');
  const m = re.exec(md);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next = md.slice(start).search(/^##\s/m);
  return { start, end: next < 0 ? md.length : start + next };
}

/** The journal questions, as written. */
function questionsOf(md) {
  const s = sectionOf(md, PARTS.questions);
  if (!s) return [];
  return md.slice(s.start, s.end).split('\n').map(l => l.match(/^\s*(?:\d+[.)]|[-*•])\s+(.+)$/)).filter(Boolean).map(m => m[1].trim());
}

/** What's wrong with a question, if anything (empty list if it keeps the rules). */
function questionProblems(q) {
  const p = [];
  const t = q.replace(/\*+/g, '').trim();
  if (!/\?$/.test(t)) p.push('not a question');
  if ((t.match(/[.!?](\s|$)/g) || []).length > 1) p.push('more than one sentence');
  if (/^(do|does|did|are|is|am|was|were|will|would|should|could|can|have|has)\b/i.test(t)) p.push('can be answered yes or no');
  if (/^how (can|could|might) (i|you|we)\b.*\bmore\b/i.test(t)) p.push('assumes the answer is "more"');
  if (/\b(you|your)\b/i.test(t) && !/\b(i|my|me)\b/i.test(t)) p.push('not in the first person');
  if (t.split(/\s+/).length > 32) p.push('too long');
  const low = t.toLowerCase();
  for (const s of STOCK) if (low.includes(s)) p.push(`stock phrase "${s}"`);
  return p;
}

/**
 * md: what the AI wrote; sources: the sources sent, in label order; passageText; extra: other texts it may quote
 * (journal excerpts); inBible: phrase → true if it's somewhere in the WEB.
 * Returns { md, flags: [{ kind, text }], questionProblems: [...] }.
 */
function verify(md, { sources = [], passageText = '', extra = [], inBible = () => false } = {}) {
  const flags = [];
  const pool = [passageText, ...extra, ...sources.map(s => s.text)].map(flat).join(' \n ');
  const srcPool = sources.map(s => flat(s.text)).join(' \n ');
  let out = String(md);

  // 3. source labels
  out = out.replace(/\[S(\d+)((?:\s*,\s*S?\d+)*)\]/g, (all, first, rest) => {
    const nums = [first, ...(rest ? rest.split(',').map(x => x.replace(/\D/g, '')).filter(Boolean) : [])].map(Number);
    const ok = nums.filter(n => n >= 1 && n <= sources.length);
    if (ok.length < nums.length) flags.push({ kind: 'label', text: `Removed a reference to a source that wasn’t given (${all}).` });
    return ok.length ? `[${ok.map(n => 'S' + n).join(', ')}]` : '';
  }).replace(/ +([.,;:])/g, '$1');

  // 1. quotations
  out = out.replace(/(“([^”\n]{3,600})”|"([^"\n]{3,600})")/g, (all, _q, a, b) => {
    const inner = a != null ? a : b;
    const words = flat(inner);
    if (words.split(' ').length < 4) return all;
    if (pool.includes(words) || inBible(inner)) return all;
    flags.push({ kind: 'quote', text: inner.length > 90 ? inner.slice(0, 87) + '…' : inner });
    return inner;
  });

  // 2. Greek and Hebrew
  const seen = new Set();
  const check = w => { const f = flat(w); return !f || srcPool.includes(f); };
  out = out.replace(/[Ͱ-Ͽἀ-῿]{2,}(?:\s+[Ͱ-Ͽἀ-῿]{2,})*|[֐-׿]{2,}(?:\s+[֐-׿]{2,})*/g, w => {
    if (check(w)) return w;
    if (!seen.has(w)) { seen.add(w); flags.push({ kind: 'word', text: w }); }
    return `${w} (not found in the sources)`;
  });
  const ws = sectionOf(out, PARTS.words);
  if (ws) {
    let part = out.slice(ws.start, ws.end);
    part = part.replace(/(?<![*\w])\*([^*\n]{2,40})\*(?!\*)/g, (all, term) => {
      if (/[Ͱ-Ͽἀ-῿֐-׿]/.test(term) || check(term) || seen.has(term)) return all;
      seen.add(term); flags.push({ kind: 'word', text: term });
      return `${all} (not found in the sources)`;
    });
    out = out.slice(0, ws.start) + part + out.slice(ws.end);
  }

  // 4. questions
  const problems = [];
  for (const q of questionsOf(out)) { const p = questionProblems(q); if (p.length) problems.push(`"${q}": ${p.join(', ')}`); }
  return { md: out, flags, questionProblems: problems };
}

/** Put new questions in place of the old ones. */
function replaceQuestions(md, questions) {
  const s = sectionOf(md, PARTS.questions);
  if (!s || !questions.length) return md;
  return md.slice(0, s.start) + '\n\n' + questions.map((q, i) => `${i + 1}. ${q}`).join('\n') + '\n\n' + md.slice(s.end).replace(/^\n+/, '');
}

module.exports = { verify, questionsOf, questionProblems, replaceQuestions, sectionOf, flat };
