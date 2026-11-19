'use strict';
/**
 * Bible study: the requests the page makes (registered in backend.js for both Windows and Android).
 *
 *   study:status, study:setKey, study:forgetKey, study:account          your OpenRouter key and spending
 *   study:offer, study:download, study:removePack                       the library packs
 *   study:pick                                                          a starting point → a passage
 *   study:sources                                                       sources for a passage (no AI, works offline)
 *   study:journalMatches                                                your entries that touch a passage (on this device, with permission)
 *   study:generate, study:cancel, study:ask                             writing a study, and the conversation about it
 *   study:history, study:get, study:save, study:forget, study:clearHistory
 *   study:bookmarks, study:bookmark, study:prayers, study:setPrayers
 */
const { NOT_WORD } = require('./text');   // not \p{L}: the Android engine has no Unicode tables
const path = require('path');
const crypto = require('crypto');
const bible = require('../bible');
const { BOOKS } = require('../bible-books');
const refs = require('./refs');
const { OpenRouter, MODELS, DEFAULT_MODEL, MODEL_RE } = require('./openrouter');
const { Library, tokenize } = require('./library');
const { retrieve } = require('./retrieve');
const prompts = require('./prompts');
const { verify, questionsOf, replaceQuestions, questionProblems } = require('./verify');

const STUDY_CATEGORY = { id: 'bible-study', name: 'Bible study', color: '#4f6aa8' };

function registerStudy({ handle, vault, send, readSettings, deviceDir, libraryDir, fetch, secretStore, appVersion, openRouterBase, libraryRelease }) {
  const or = new OpenRouter({ ...secretStore('openrouter.json'), fetch, usageFile: path.join(deviceDir, 'study-usage.json'), base: openRouterBase || undefined, appVersion });
  const lib = new Library({ dir: libraryDir || path.join(deviceDir, 'library'), fetch, builtinFile: path.join(__dirname, '..', 'readings', 'classics.json'), release: libraryRelease || undefined });
  const running = new Map();   // requestId → AbortController

  const settings = () => {
    const s = readSettings();
    return { model: MODEL_RE.test(s.studyModel || '') ? s.studyModel : DEFAULT_MODEL, mode: prompts.MODES[s.studyMode] ? s.studyMode : 'devotional',
      length: prompts.LENGTHS[s.studyLength] ? s.studyLength : 'standard', journal: !!s.studyJournal, privateHosts: s.studyPrivateHosts !== false };
  };
  // Searching by meaning needs the key, a connection, and packs built with embeddings.
  const embedder = () => {
    const e = lib.embedModel();
    if (!e || !or.hasKey()) return null;
    return async text => (await or.embed([text], { model: e.model }))[0];   // same model and size as the packs were built with
  };

  // ---------- key, model, spending ----------
  handle('study:status', () => ({
    key: or.hasKey(), ...settings(), models: MODELS, modes: Object.entries(prompts.MODES).map(([id, m]) => ({ id, label: m.label, about: m.about })),
    lengths: Object.entries(prompts.LENGTHS).map(([id, l]) => ({ id, label: l.label, words: l.words })),
    library: lib.installed(), hasPacks: lib.hasPacks(), meaning: !!lib.embedModel(), month: or.month(), downloading: lib.downloading,
  }));
  handle('study:setKey', async key => { const info = await or.setKey(key); return { key: true, ...info }; });
  handle('study:forgetKey', () => or.forget());
  handle('study:account', () => or.status());

  // ---------- library packs ----------
  handle('study:offer', () => lib.available());
  handle('study:download', async packId => {
    let last = 0;
    return lib.download(String(packId), (done, total) => {
      const now = Date.now();
      if (now - last > 250 || done >= total) { last = now; send('study:download', { pack: packId, done, total }); }
    });
  });
  handle('study:removePack', packId => lib.remove(String(packId)));

  // ---------- starting points ----------
  const passageOf = (ref, translation = 'web') => {
    const r = refs.norm(ref);
    const name = BOOKS[r[0]].name;
    let text = '';
    if (r[1] === r[3]) {
      const lastVerse = r[2] ? r[4] : 200;
      const v = bible.verseText(`${name} ${r[1]}:${r[2] || 1}-${lastVerse}`, translation);
      text = v ? v.text : '';
    } else {
      for (let c = r[1]; c <= r[3]; c++) {
        const v = bible.verseText(`${name} ${c}:${c === r[1] ? r[2] || 1 : 1}-${c === r[3] ? r[4] || 200 : 200}`, translation);
        if (v) text += (text ? '\n\n' : '') + v.text;
      }
    }
    return { ref: r, label: refs.label(r), passageText: text, translation: 'World English Bible' };
  };
  // Passages for "Surprise me": the verses of the day, widened to the few verses around them.
  const randomPassage = () => {
    const pick = bible.VERSES[Math.floor(Math.random() * bible.VERSES.length)];
    const r = refs.parse(pick);
    const ch = bible.chapter('web', r[0], r[1]);
    const last = ch ? Math.max(...ch.blocks.filter(b => b[0] !== 'h').flatMap(b => b[1].map(x => x[0]))) : r[4];
    return [r[0], r[1], Math.max(1, r[2] - 3), r[1], Math.min(last, r[4] + 3)];
  };
  // A theme, a concern or an entry: the AI suggests a passage if it can; otherwise the best keyword match in the Bible.
  async function passageFor(text) {
    const s = settings();
    if (or.hasKey()) {
      try {
        const r = await or.chat({ model: s.model, maxTokens: 600, temperature: 0.4, privateHosts: s.privateHosts, messages: [
          { role: 'system', content: 'You suggest one Bible passage for reflection. Reply with only its reference in the form "Book chapter:verse-verse", 3 to 15 verses long, nothing else.' },
          { role: 'user', content: String(text).slice(0, 1500) },
        ] });
        const ref = refs.parse(r.text.replace(/[“”"*.]/g, '').trim());
        if (ref && ref[2] && passageOf(ref).passageText) return ref;
      } catch {}
    }
    const words = tokenize(text).slice(0, 6).join(' ');
    const hit = words && bible.search('web', words.split(' ').slice(0, 3).join(' ')).results[0];
    if (hit) return [hit.bookIndex, hit.chapter, Math.max(1, hit.verse - 2), hit.chapter, hit.verse + 3];
    return randomPassage();
  }
  const planPassage = () => {
    const st = vault.getBible();
    if (!st || !st.plan) throw new Error('Choose a reading plan first (Bible → Plans).');
    const days = Math.floor((Date.now() - new Date(st.start + 'T00:00:00').getTime()) / 864e5);
    const day = bible.planDay(st.plan, Math.max(0, days)) || [];
    // Several chapters: study the New Testament one if there is one (it's usually the shorter reading).
    const pick = day.find(([b]) => b >= 39) || day[0];
    if (!pick) throw new Error('Today’s reading couldn’t be found.');
    return [pick[0], pick[1], 0, pick[1], 0];
  };
  handle('study:pick', async input => {
    input = input || {};
    const text = String(input.text || '').slice(0, 2000);
    if (input.kind === 'ref') {
      const p = refs.parse(text) || (() => { const b = bible.parseRef(text); return b && refs.fromPick(b); })();
      if (!p) throw new Error('That reference wasn’t recognised. Try something like “Matthew 11:28–30”.');
      const out = passageOf(p);
      if (!out.passageText) throw new Error('That passage isn’t in the World English Bible.');
      return out;
    }
    if (input.kind === 'stored' && Array.isArray(input.ref)) return passageOf(input.ref);
    if (input.kind === 'plan') return passageOf(planPassage());
    if (input.kind === 'random') return passageOf(randomPassage());
    if (input.kind === 'topic') { if (!text.trim()) throw new Error('Write a theme first.'); return { ...passageOf(await passageFor(text)), topic: text }; }
    if (input.kind === 'concern') { if (!text.trim()) throw new Error('Write what’s on your mind first.'); return { ...passageOf(await passageFor(text)), concern: text }; }
    if (input.kind === 'entry') {
      // Only the excerpt the person saw and agreed to (study:entryExcerpt) is used, never the whole entry.
      if (!settings().journal) throw new Error('Turn on “Let Bible study read my journal” in Settings → Bible study first.');
      const e = vault.get(String(input.id));
      const excerpt = String(input.excerpt || '').slice(0, 900);
      if (!excerpt.trim() || !String(e.text || '').includes(excerpt.slice(0, 40))) throw new Error('Choose the words to share first.');
      return { ...passageOf(await passageFor(excerpt)), entryIds: [e.id], entryExcerpt: excerpt };
    }
    throw new Error('Unknown starting point');
  });

  /** The opening of an entry, up to about 700 characters, to show before it's shared (nothing is sent). */
  handle('study:entryExcerpt', id => {
    if (!settings().journal) throw new Error('Turn on “Let Bible study read my journal” in Settings → Bible study first.');
    const e = vault.get(String(id));
    const sentences = String(e.text || '').split(/(?<=[.!?])\s+/);
    let out = '';
    for (const x of sentences) { if (out && (out + ' ' + x).length > 700) break; out = out ? out + ' ' + x : x; }
    return { id: e.id, date: e.date, title: e.title || '', excerpt: out.slice(0, 900) };
  });

  // ---------- sources (no AI) ----------
  handle('study:sources', async (passage, opts = {}) => {
    const p = passageOf(passage.ref);
    const list = await retrieve(lib, embedder(), { ref: p.ref, passageText: p.passageText, topic: passage.topic || '', mode: opts.mode || 'devotional', length: 'extended' }, { budget: 80000 });
    return { ...p, sources: list, hasPacks: lib.hasPacks() };
  });

  // ---------- your journal (only with permission, matched on this device) ----------
  function journalMatches(passage, limit = 3) {
    if (!settings().journal) return [];
    const q = new Set(tokenize([passage.passageText, passage.topic, passage.concern].filter(Boolean).join(' ')));
    if (!q.size) return [];
    const metas = vault.list().filter(m => m.category !== STUDY_CATEGORY.id && m.text && m.words >= 20);
    const n = metas.length || 1;
    const df = new Map();
    const toks = metas.map(m => { const t = new Set(tokenize(m.text + ' ' + (m.tags || []).join(' '))); for (const w of t) df.set(w, (df.get(w) || 0) + 1); return t; });
    // At least three of the passage's telling words in common; rarer words count for more.
    const scored = metas.map((m, i) => { let s = 0, k = 0; for (const w of q) if (toks[i].has(w)) { s += Math.log(1 + n / df.get(w)); k++; } return { m, s, k }; })
      .filter(x => x.k >= 3).sort((a, b) => b.s - a.s).slice(0, limit);
    return scored.map(({ m }) => ({ id: m.id, date: m.date, title: m.title || '', excerpt: excerptOf(m.text, q) }));
  }
  const excerptOf = (text, q) => {
    const sentences = String(text).split(/(?<=[.!?])\s+/);
    let best = 0, at = 0;
    sentences.forEach((s, i) => { const t = tokenize(s); const sc = t.filter(w => q.has(w)).length; if (sc > best) { best = sc; at = i; } });
    return sentences.slice(Math.max(0, at - 1), at + 3).join(' ').slice(0, 700);
  };
  handle('study:journalMatches', passage => journalMatches(passageOf(passage.ref) && { ...passageOf(passage.ref), topic: passage.topic, concern: passage.concern }));

  // ---------- writing a study ----------
  const inBible = phrase => {
    const words = String(phrase).replace(NOT_WORD, ' ').trim().split(/\s+/);
    if (words.length < 4) return false;
    const r = bible.search('web', `"${words.slice(0, 8).join(' ')}"`, 1);
    return r.total > 0;
  };
  const newId = () => crypto.randomUUID();

  /**
   * req: { ref, topic?, concern?, entryIds?: [ids the person agreed to share], mode?, length? }
   * Streams the text as it's written (event study:delta, requestId, piece) and returns the finished study.
   */
  handle('study:generate', async (req, requestId) => {
    req = req || {};
    const s = settings();
    const mode = prompts.MODES[req.mode] ? req.mode : s.mode;
    const length = prompts.LENGTHS[req.length] ? req.length : s.length;
    const p = passageOf(req.ref);
    if (!p.passageText) throw new Error('That passage couldn’t be found in the World English Bible.');
    const topic = String(req.topic || '').slice(0, 300), concern = String(req.concern || '').slice(0, 2000);
    let journal = [];
    if (Array.isArray(req.entryIds) && req.entryIds.length) {
      if (!s.journal) throw new Error('Turn on “Let Bible study read my journal” in Settings → Bible study first.');
      journal = req.entryIds.slice(0, 3).map(id => { try { const e = vault.get(String(id)); return { date: e.date, title: e.title || '', excerpt: String(req.excerpts && req.excerpts[id] || excerptOf(e.text, new Set(tokenize(p.passageText)))).slice(0, 900) }; } catch { return null; } }).filter(Boolean);
    }
    const sources = await retrieve(lib, embedder(), { ref: p.ref, passageText: p.passageText, topic, question: concern, mode, length });
    const ctrl = new AbortController();
    const rid = String(requestId || newId());
    running.set(rid, ctrl);
    try {
      const study = { ref: p.label, passageText: p.passageText, translation: p.translation, mode, length, topic, concern, journal };
      const res = await or.chat({
        model: s.model, messages: prompts.studyMessages(study, sources), maxTokens: prompts.LENGTHS[length].maxTokens, temperature: 0.7, reasoning: prompts.THINKING,
        privateHosts: s.privateHosts, signal: ctrl.signal, onDelta: piece => send('study:delta', rid, piece),
      });
      let { md, flags, questionProblems: probs } = verify(res.text, { sources, passageText: p.passageText, extra: journal.map(j => j.excerpt), inBible });
      if (res.cut) flags.push({ kind: 'cut', text: 'The AI stopped before it finished, so the end is missing. Ask again, or try a shorter length.' });
      let cost = res.usage.cost;
      if (probs.length) {   // once, ask for questions that keep the rules
        try {
          const qs = questionsOf(md);
          const fix = await or.chat({ model: s.model, messages: prompts.questionFixMessages(p.label, p.passageText, qs, probs), maxTokens: 1500, temperature: 0.6, privateHosts: s.privateHosts, signal: ctrl.signal });
          cost += fix.usage.cost;
          const better = fix.text.split('\n').map(l => l.match(/^\s*\d+[.)]\s+(.+)$/)).filter(Boolean).map(m => m[1].trim());
          if (better.length >= 2 && better.filter(q => !questionProblems(q).length).length >= better.length - 1) { md = replaceQuestions(md, better); flags.push({ kind: 'questions', text: 'Questions rewritten to keep them open.' }); }
        } catch {}
      }
      const title = ((md.match(/^#\s+(.+)$/m) || [])[1] || p.label).trim().slice(0, 200);
      const entry = {
        id: newId(), at: new Date().toISOString(), ref: p.ref, label: p.label, mode, length, title, model: res.model, entryId: '',
        md, passageText: p.passageText, translation: 'WEB', topic, flags, thread: [], usage: { cost },
        sources: sources.map(x => ({ id: x.id, author: x.author, work: x.work, year: x.year, section: x.section, licence: x.licence, credit: x.credit, url: x.url, text: x.text, why: x.why })),
      };
      const st = vault.getStudy();
      vault.setStudy({ history: [entry, ...st.history].slice(0, 50) });
      return { ...entry, barclay: refs.barclayLink(entry.ref), sharedJournal: journal.length };
    } finally { running.delete(rid); }
  });
  handle('study:cancel', requestId => { const c = running.get(String(requestId)); if (c) c.abort(); return !!c; });

  // A follow-up question about a study: new sources for the question, the same checks, kept with the study.
  handle('study:ask', async (studyId, question, requestId) => {
    question = String(question || '').trim().slice(0, 1500);
    if (!question) throw new Error('Write a question first.');
    const st = vault.getStudy();
    const h = st.history.find(x => x.id === studyId);
    if (!h) throw new Error('That study is no longer in your history.');
    const s = settings();
    const sources = await retrieve(lib, embedder(), { ref: h.ref, passageText: h.passageText, question, mode: h.mode, length: 'short' });
    const ctrl = new AbortController();
    const rid = String(requestId || newId());
    running.set(rid, ctrl);
    try {
      const res = await or.chat({ model: s.model, messages: prompts.askMessages({ ref: h.label, passageText: h.passageText, mode: h.mode, translation: 'WEB' }, h.thread, question, sources),
        maxTokens: 12000, temperature: 0.6, reasoning: prompts.THINKING, privateHosts: s.privateHosts, signal: ctrl.signal, onDelta: piece => send('study:delta', rid, piece) });
      const { md, flags } = verify(res.text, { sources, passageText: h.passageText, inBible });
      if (res.cut) flags.push({ kind: 'cut', text: 'The AI stopped before it finished, so the end is missing. Ask again, or try a shorter length.' });
      const fresh = vault.getStudy();
      const item = fresh.history.find(x => x.id === studyId);
      if (item) {
        item.thread = [...item.thread, { role: 'user', content: question }, { role: 'assistant', content: md }];
        item.usage.cost += res.usage.cost;
        vault.setStudy({ history: fresh.history });
      }
      return { answer: md, flags, sources: sources.map(x => ({ id: x.id, author: x.author, work: x.work, year: x.year, section: x.section, credit: x.credit, url: x.url, text: x.text })) };
    } finally { running.delete(rid); }
  });

  // ---------- history, saving, bookmarks, prayers ----------
  handle('study:history', () => vault.getStudy().history.map(({ md, passageText, sources, thread, ...rest }) => ({ ...rest, questions: questionsOf(md).length, sources: sources.length })));
  handle('study:get', id => { const h = vault.getStudy().history.find(x => x.id === id); return h ? { ...h, barclay: refs.barclayLink(h.ref) } : null; });
  handle('study:forget', id => { const st = vault.getStudy(); vault.setStudy({ history: st.history.filter(h => h.id !== id) }); return true; });
  handle('study:clearHistory', () => { vault.setStudy({ history: [] }); return true; });

  /** Save a study (with your reflection on top) as a journal entry in the "Bible study" category. */
  handle('study:save', (studyId, { html = '', reflection = '' } = {}) => {
    const st = vault.getStudy();
    const h = st.history.find(x => x.id === studyId);
    if (!h) throw new Error('That study is no longer in your history.');
    const cats = vault.getMeta().categories || [];
    if (!cats.some(c => c.id === STUDY_CATEGORY.id)) vault.setCategories([...cats, { ...STUDY_CATEGORY, parent: '' }]);
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const text = String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    const book = BOOKS[h.ref[0]] ? BOOKS[h.ref[0]].name.toLowerCase() : '';
    const meta = vault.save({
      id: h.entryId || undefined, date: h.entryId ? undefined : date, time: `${pad(today.getHours())}:${pad(today.getMinutes())}`,
      title: h.title, category: STUDY_CATEGORY.id, tags: ['bible study', book, (prompts.MODES[h.mode] || {}).label || ''].filter(Boolean).map(t => t.toLowerCase()),
      html: String(html), text: (String(reflection || '') + ' ' + text).trim(),
    });
    h.entryId = meta.id;
    vault.setStudy({ history: st.history });
    return meta;
  });

  handle('study:bookmarks', () => vault.getStudy().bookmarks);
  handle('study:bookmark', (passage, on) => {
    const st = vault.getStudy();
    const id = String(passage && passage.id || '');
    let list = st.bookmarks.filter(b => b.id !== id);
    if (on) list = [{ id, author: passage.author, work: passage.work, section: passage.section, text: passage.text, credit: passage.credit, at: new Date().toISOString() }, ...list];
    return vault.setStudy({ bookmarks: list }).bookmarks;
  });
  handle('study:prayers', () => vault.getStudy().prayers);
  handle('study:setPrayers', list => vault.setStudy({ prayers: list }).prayers);

  return { or, lib };
}

module.exports = { registerStudy, STUDY_CATEGORY };
