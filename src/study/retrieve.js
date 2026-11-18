'use strict';
/**
 * Choosing the sources for a study.
 *
 *  1. Passages tagged with the verses being studied come first (closest verses first).
 *  2. Keyword search (on this device) and, with an OpenRouter key and packs built with embeddings, search by meaning
 *     add passages the verse tags miss.
 *  3. The three lists are merged (reciprocal rank fusion), favouring the kinds of source the mode needs, and no work
 *     gives more than two passages, so several voices are heard. The total is kept within the length's budget.
 */
const { MODES, LENGTHS } = require('./prompts');

// Characters of source text to send, by length (about 4 characters a token).
const BUDGET = { short: 16000, standard: 32000, extended: 60000 };
const PER_WORK = 2;
const K = 20;

/**
 * lib: Library; embed: async text → vector, or null (offline, no key, or packs without vectors)
 * q: { ref (stored form), passageText, topic, question, mode, length }
 * Returns [{ id, author, work, year, section, category, refs, text, licence, credit, url, caveat, why, score }]
 */
async function retrieve(lib, embed, q, { budget } = {}) {
  const mode = MODES[q.mode] || MODES.devotional;
  const max = budget || BUDGET[q.length] || BUDGET.standard;
  const byRef = lib.byRef(q.ref, 80);
  // Keyword matches count only when they share several telling words with the passage and are near the best match.
  const allWords = lib.byWords([q.passageText, q.topic, q.question].filter(Boolean).join(' '), 80);
  const bestWords = allWords.length ? allWords[0].score : 0;
  const words = allWords.filter(h => h.hits >= 2 && h.score >= bestWords * 0.45);
  let meaning = [];
  if (embed) {
    try {
      const v = await embed([q.passageText, q.topic, q.question].filter(Boolean).join('\n'));
      if (v) { const all = lib.byVector(v, 80); const top = all.length ? all[0].score : 0; meaning = all.filter(h => h.score >= top * 0.8); }
    } catch {}
  }

  const fused = new Map();
  const add = (list, weight, why) => list.forEach((h, rank) => {
    const key = `${h.pack}:${h.i}`;
    const f = fused.get(key) || { ...h, key, score: 0, close: 0, why: [] };
    f.score += weight / (K + rank + 1) * (why === 'verses' ? 0.5 + h.score : 1);
    if (why === 'verses') f.close = Math.max(f.close, h.score);
    if (!f.why.includes(why)) f.why.push(why);
    fused.set(key, f);
  });
  add(byRef, 2, 'verses');
  add(meaning, 1, 'meaning');
  add(words, 0.6, 'words');
  for (const f of fused.values()) {
    const w = mode.wants.indexOf(f.cat);
    if (w >= 0) f.score *= w < 2 ? 1.5 : 1.25;
  }
  // Passages on these very verses (or close to them) always come before the rest.
  const ranked = [...fused.values()].sort((a, b) => (b.close >= 0.5) - (a.close >= 0.5) || b.score - a.score);

  const chosen = [], perWork = new Map();
  let used = 0;
  const take = h => {
    if (chosen.includes(h)) return false;
    if ((perWork.get(h.src) || 0) >= PER_WORK) return false;
    const p = lib.passage(h.pack, h.i);
    if (!p || !p.text.trim()) return false;
    if (used + p.text.length > max && chosen.length) return false;
    chosen.push(h); h.p = p; used += p.text.length;
    perWork.set(h.src, (perWork.get(h.src) || 0) + 1);
    return true;
  };
  // First, the best of each kind the mode wants (if any is reasonably relevant), then the rest in order.
  const top = ranked.slice(0, 40);
  for (const cat of mode.wants) { const h = top.find(x => x.cat === cat && (x.close > 0 || x.why.length > 1 || x.why[0] === 'meaning')); if (h) take(h); }
  for (const h of ranked) { if (used >= max * 0.95) break; take(h); }
  // Present them in a sensible order: on-the-verses first, then by score.
  chosen.sort((a, b) => (b.close >= 0.5) - (a.close >= 0.5) || b.score - a.score);
  return chosen.map(h => ({ ...h.p, why: h.why.includes('verses') ? 'verses' : h.why.includes('meaning') ? 'meaning' : 'words', score: +h.score.toFixed(4) }));
}

module.exports = { retrieve, BUDGET, LENGTHS };
