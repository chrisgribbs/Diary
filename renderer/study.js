'use strict';
/* WellWrite — Bible study (the Study tab in the Bible view, and Settings → Bible study).
 * Loaded after app.js and uses its helpers (api, state, el, toast, openDialog…).
 *
 * A study begins from a passage (typed, chosen in the reader, today's reading or "Surprise me"), a theme, something
 * on your mind, or (with permission) one of your entries. WellWrite finds what the commentaries and classics say on
 * those verses, then the AI writes the study from them. Every source is shown with its credit; quotations and Greek
 * words are checked against the sources before you see them. */

const study = {
  view: 'start',        // start | passage | writing | study | sources | history
  status: null,
  passage: null,        // { ref, label, passageText, topic?, concern?, entryIds? }
  current: null,        // the study being shown
  live: '',             // text so far, while it's being written
  rid: '',
  asking: false,
  journal: null,        // [{ id, date, title, excerpt, on }] for Personal Reflection
};

/* ---------- a little Markdown, for what the AI writes (built as elements, never as HTML) ---------- */
const STUDY_PARTS = {
  understanding: 'Understanding the passage', background: 'Historical and cultural background', words: 'Greek and Hebrew words',
  commentary: 'Commentary', theology: 'Theological implications', today: 'Living it today', reflection: 'Contemplative reflection',
  lectio: 'Reading slowly', meditatio: 'Meditation', oratio: 'Prayer', contemplatio: 'Resting', society: 'For the common good',
  views: 'How Christians have read it', questions: 'Questions for your journal', prayer: 'Closing prayer',
};
function mdSplit(md) {
  const out = { title: '', sections: [] };
  let cur = null;
  for (const line of String(md || '').replace(/\r/g, '').split('\n')) {
    const h1 = line.match(/^#\s+(.+)$/), h2 = line.match(/^##\s+(.+)$/);
    if (h1 && !out.title) { out.title = h1[1].trim(); continue; }
    if (h2) { cur = { heading: h2[1].trim(), lines: [] }; out.sections.push(cur); continue; }
    if (!cur) { cur = { heading: '', lines: [] }; out.sections.push(cur); }
    cur.lines.push(line);
  }
  for (const s of out.sections) s.text = s.lines.join('\n').trim();
  return out;
}
/** Blocks of a section: paragraphs, numbered lists, bullet lists. */
function mdBlocks(text) {
  const blocks = [];
  for (const chunk of String(text).split(/\n{2,}/)) {
    const lines = chunk.split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    if (lines.every(l => /^\s*\d+[.)]\s+/.test(l))) blocks.push({ kind: 'ol', items: lines.map(l => l.replace(/^\s*\d+[.)]\s+/, '')) });
    else if (lines.every(l => /^\s*[-*•]\s+/.test(l))) blocks.push({ kind: 'ul', items: lines.map(l => l.replace(/^\s*[-*•]\s+/, '')) });
    else blocks.push({ kind: 'p', text: lines.join(' ') });
  }
  return blocks;
}
const INLINE_RE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[S\d+(?:\s*,\s*S\d+)*\])/g;
/** Inline text as nodes: bold, italic, and [S2] as a little button that shows the source. */
function mdInline(text, onSource) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(INLINE_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(el('strong', {}, t.slice(2, -2)));
    else if (t.startsWith('[S')) {
      const nums = t.match(/\d+/g).map(Number);
      out.push(el('span', { class: 'st-cites' }, ...nums.map(n => el('button', { type: 'button', class: 'st-cite', title: 'Show source ' + n, onclick: () => onSource && onSource(n) }, String(n)))));
    } else out.push(el('em', {}, t.slice(1, -1)));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function mdNodes(text, onSource) {
  return mdBlocks(text).map(b => b.kind === 'p' ? el('p', {}, ...mdInline(b.text, onSource))
    : el(b.kind, {}, ...b.items.map(i => el('li', {}, ...mdInline(i, onSource)))));
}
/** The same, as HTML for a journal entry (everything escaped; source labels kept as plain [1]). */
function mdHtml(text) {
  const inline = t => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/\[S(\d+(?:\s*,\s*S\d+)*)\]/g, (_, n) => `<sup>[${n.replace(/S/g, '')}]</sup>`);
  return mdBlocks(text).map(b => b.kind === 'p' ? `<p>${inline(b.text)}</p>` : `<${b.kind}>${b.items.map(i => `<li>${inline(i)}</li>`).join('')}</${b.kind}>`).join('');
}

/* ---------- the Study tab ---------- */
async function renderStudyView(body) {
  try { study.status = await api.studyStatus(); } catch (x) { body.replaceChildren(el('p', { class: 'rv-note warn' }, x.message)); return; }
  const v = study.view;
  if (v === 'writing') return drawWriting(body);
  if (v === 'study' && study.current) return drawStudy(body);
  if (v === 'sources' && study.passage) return drawSources(body);
  if (v === 'passage' && study.passage) return drawPassage(body);
  if (v === 'history') return drawHistory(body);
  return drawStart(body);
}
const studyBody = () => $('#bibleBody');
const studyRedraw = () => { const b = studyBody(); if (b && state.mode === 'bible' && state.bibleTab === 'study') renderStudyView(b); };
const studyGo = view => { study.view = view; studyRedraw(); const sv = $('#bibleView'); if (sv) sv.scrollTop = 0; };
/** Open the Study tab on a passage (from the reader's selection, or anywhere else). */
async function studyPassage(input) {
  try { study.passage = await api.studyPick(input); study.journal = null; state.bibleTab = 'study'; study.view = 'passage'; setMode('bible'); renderBibleView(); }
  catch (x) { toast(x.message); }
}

function studyKeyNote() {
  const s = study.status;
  if (s.key) return null;
  return el('div', { class: 'st-note' },
    el('p', {}, 'To have studies written for you, add an OpenRouter key in Settings. Without one you can still read what the commentaries and classics say on any passage.'),
    el('button', { type: 'button', class: 'btn-plain', onclick: () => openSettings('study') }, 'Add a key'));
}
function studyLibraryNote() {
  const s = study.status;
  if (s.hasPacks) return null;
  return el('div', { class: 'st-note' },
    el('p', {}, 'The commentary library isn’t on this device yet: Meyer, Maclaren, Hastings, Edersheim, Vincent, Robertson and the Expositor’s Bible. Until it is, studies draw on the Bible and the spiritual classics already in WellWrite.'),
    el('button', { type: 'button', class: 'btn-plain', onclick: () => openSettings('study') }, 'Get the library'));
}

function drawStart(body) {
  const s = study.status;
  const ref = el('input', { type: 'text', class: 'st-input', placeholder: 'Matthew 11:28–30', 'aria-label': 'Passage', enterkeyhint: 'go',
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); go(); } } });
  const go = () => ref.value.trim() ? studyPassage({ kind: 'ref', text: ref.value }) : toast('Type a passage, like Psalm 23 or John 15:1–11');
  const topic = el('input', { type: 'text', class: 'st-input', placeholder: 'A theme: rest, forgiveness, courage…', maxlength: 300 });
  const concern = el('textarea', { class: 'st-input st-concern', rows: 3, maxlength: 2000, placeholder: 'Something on your mind…' });
  const hasPlan = !!(state.bible && state.bible.state && state.bible.state.plan);
  body.replaceChildren(el('div', { class: 'st-start' },
    el('p', { class: 'st-kicker' }, 'Bible study'),
    el('h2', { class: 'st-h' }, 'What would you like to read with?'),
    el('div', { class: 'st-row' }, ref, el('button', { type: 'button', class: 'btn-ink', onclick: go }, 'Study')),
    el('div', { class: 'st-chips' },
      hasPlan ? el('button', { type: 'button', class: 'st-chip', onclick: () => studyPassage({ kind: 'plan' }) }, 'Today’s reading') : null,
      el('button', { type: 'button', class: 'st-chip', onclick: () => studyPassage({ kind: 'random' }) }, 'Surprise me'),
      el('button', { type: 'button', class: 'st-chip', onclick: () => { state.bibleTab = 'read'; renderBibleView(); toast('Tap verses, then Study'); } }, 'Choose in the reader')),
    el('details', { class: 'st-more' },
      el('summary', {}, 'Or begin from a theme, or from what’s on your mind'),
      el('label', { class: 'st-label' }, 'A theme'),
      el('div', { class: 'st-row' }, topic, el('button', { type: 'button', class: 'btn-plain', onclick: () => studyPassage({ kind: 'topic', text: topic.value }) }, 'Find a passage')),
      el('label', { class: 'st-label' }, 'What’s on your mind'),
      concern,
      el('small', { class: 'st-small' }, s.key ? 'This will be sent to the AI to choose a passage and shape the study. It isn’t saved anywhere else.' : 'With a key added, this is sent to the AI to choose a passage. Without one, WellWrite looks for a passage by its words.'),
      el('div', {}, el('button', { type: 'button', class: 'btn-plain', onclick: () => studyPassage({ kind: 'concern', text: concern.value }) }, 'Find a passage'))),
    studyKeyNote(), studyLibraryNote(),
    el('div', { class: 'st-links' },
      el('button', { type: 'button', class: 'btn-link', onclick: () => studyGo('history') }, 'Your studies'),
      el('button', { type: 'button', class: 'btn-link', onclick: studyBookmarksDialog }, 'Bookmarks'),
      el('button', { type: 'button', class: 'btn-link', onclick: studyPrayerList }, 'Prayer list'))));
  focusTyping(ref);
}

function modeAndLength() {
  const s = study.status;
  const mode = el('select', { 'aria-label': 'Kind of study' }, ...s.modes.map(m => el('option', { value: m.id }, m.label)));
  mode.value = study.mode || s.mode;
  const about = el('small', { class: 'st-small' }, (s.modes.find(m => m.id === mode.value) || {}).about || '');
  const length = el('div', { class: 'st-seg', role: 'radiogroup', 'aria-label': 'Length' });
  const pickLen = id => { study.length = id; for (const b of length.children) b.setAttribute('aria-checked', String(b.dataset.id === id)); };
  for (const l of s.lengths) length.append(el('button', { type: 'button', role: 'radio', 'data-id': l.id, onclick: () => pickLen(l.id) }, l.label));
  pickLen(study.length || s.length);
  mode.addEventListener('change', () => { study.mode = mode.value; about.textContent = (s.modes.find(m => m.id === mode.value) || {}).about || ''; if (mode.value === 'personal') drawJournalChoice(); });
  return { mode, length, about };
}

async function drawPassage(body) {
  const s = study.status, p = study.passage;
  const { mode, length, about } = modeAndLength();
  const journalBox = el('div', { id: 'stJournal' });
  body.replaceChildren(el('div', { class: 'st-start' },
    el('button', { type: 'button', class: 'btn-link st-back', onclick: () => studyGo('start') }, '‹ Choose another passage'),
    el('p', { class: 'st-kicker' }, p.topic ? `A passage for “${p.topic}”` : p.concern ? 'A passage for what’s on your mind' : 'Bible study'),
    el('h2', { class: 'st-h' }, p.label),
    el('figure', { class: 'quote-card verse st-passage' }, el('blockquote', {}, p.passageText), el('figcaption', {}, 'World English Bible')),
    el('div', { class: 'st-opts' }, el('label', {}, 'Kind of study ', mode), length),
    about, journalBox,
    el('div', { class: 'st-actions' },
      el('button', { type: 'button', class: 'btn-ink', disabled: !s.key, title: s.key ? '' : 'Add an OpenRouter key in Settings first', onclick: () => writeStudy({ mode: mode.value, length: study.length }) }, 'Write the study'),
      el('button', { type: 'button', class: 'btn-plain', onclick: () => studyGo('sources') }, 'What the sources say')),
    studyKeyNote(), studyLibraryNote()));
  if (mode.value === 'personal') drawJournalChoice();
}

/** Personal Reflection: which of your entries may be shared (only with the setting on; nothing is ticked for you). */
async function drawJournalChoice() {
  const box = $('#stJournal');
  if (!box) return;
  const s = study.status;
  if (!s.journal) {
    box.replaceChildren(el('div', { class: 'st-note' }, el('p', {}, 'Personal Reflection can draw on your own journal, but only if you allow it. Nothing from your journal is sent unless you turn this on and choose the entries.'),
      el('button', { type: 'button', class: 'btn-plain', onclick: () => openSettings('study') }, 'Settings → Bible study')));
    return;
  }
  if (!study.journal) {
    try { study.journal = (await api.studyJournalMatches(study.passage)).map(j => ({ ...j, on: false })); } catch { study.journal = []; }
  }
  if (!study.journal.length) { box.replaceChildren(el('p', { class: 'st-small' }, 'None of your entries seem to touch this passage closely, so the study won’t draw on your journal.')); return; }
  box.replaceChildren(el('div', { class: 'st-note' },
    el('p', {}, 'These entries touch this passage. Tick the ones you’re happy to share; only the words shown are sent to the AI.'),
    ...study.journal.map(j => {
      const c = el('input', { type: 'checkbox', onchange: e => { j.on = e.target.checked; } }); c.checked = j.on;
      return el('label', { class: 'st-jrow' }, c, el('span', {}, el('b', {}, j.title || fmt(j.date, { day: 'numeric', month: 'long', year: 'numeric' })), el('small', {}, j.excerpt)));
    })));
}

async function writeStudy({ mode, length }) {
  const p = study.passage;
  const entryIds = mode === 'personal' && study.journal ? study.journal.filter(j => j.on).map(j => j.id) : [];
  const excerpts = Object.fromEntries((study.journal || []).filter(j => j.on).map(j => [j.id, j.excerpt]));
  study.rid = 'st-' + Date.now();
  study.live = '';
  study.writing = { label: p.label, mode, passageText: p.passageText };
  studyGo('writing');
  try {
    const got = await api.studyGenerate({ ref: p.ref, topic: p.topic || '', concern: p.concern || '', entryIds, excerpts, mode, length }, study.rid);
    study.current = got;
    study.reflection = '';
    studyGo('study');
  } catch (x) {
    if (study.view === 'writing') { study.view = 'passage'; studyRedraw(); }
    if (!/Stopped/.test(x.message)) toast(x.message);
  } finally { study.rid = ''; }
}

function studyHeader(kicker, title, label) {
  return el('header', { class: 'st-head' }, el('p', { class: 'st-kicker' }, kicker), el('h2', { class: 'st-title' }, title), el('p', { class: 'st-ref' }, label));
}

function drawWriting(body) {
  const w = study.writing || {};
  const modeLabel = ((study.status.modes || []).find(m => m.id === w.mode) || {}).label || 'Bible study';
  const live = el('div', { class: 'st-live', 'aria-live': 'polite' });
  body.replaceChildren(el('article', { class: 'st-card' },
    studyHeader(modeLabel, 'Writing…', w.label),
    el('figure', { class: 'quote-card verse st-passage' }, el('blockquote', {}, w.passageText || '')),
    live,
    el('div', { class: 'st-actions' }, el('button', { type: 'button', class: 'btn-plain', onclick: () => { api.studyCancel(study.rid); study.view = 'passage'; studyRedraw(); } }, 'Stop'))));
  drawLive();
}
let liveTimer = 0;
function drawLive() {
  const box = document.querySelector('.st-live');
  if (!box) return;
  const parts = mdSplit(study.live);
  const t = document.querySelector('.st-title');
  if (t && parts.title) t.textContent = parts.title;
  box.replaceChildren(...parts.sections.flatMap(s => [s.heading ? el('h3', {}, s.heading) : null, ...mdNodes(s.text)]).filter(Boolean),
    el('p', { class: 'st-small st-pulse' }, study.live ? '' : 'Finding sources and beginning to write…'));
}
if (api.onStudyDelta) api.onStudyDelta((rid, piece) => {
  if (rid === study.rid) { study.live += piece; if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = 0; drawLive(); }, 120); }
  if (study.asking && rid === study.asking.rid) { study.asking.text += piece; const n = $('#stAnswerLive'); if (n) n.replaceChildren(...mdNodes(study.asking.text)); }
});

/** A finished study, laid out like the mock-up: the passage, its meaning, parts to explore, the question and your reflection. */
function drawStudy(body) {
  const c = study.current;
  const parts = mdSplit(c.md);
  const by = h => parts.sections.find(s => s.heading.toLowerCase() === String(h).toLowerCase());
  const modeLabel = ((study.status.modes || []).find(m => m.id === c.mode) || {}).label || 'Bible study';
  const showSource = n => {
    const d = $(`#st-src-${n}`);
    if (d) { d.open = true; d.scrollIntoView({ block: 'center', behavior: 'smooth' }); d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1400); }
  };
  const understanding = by(STUDY_PARTS.understanding);
  const questions = by(STUDY_PARTS.questions);
  const prayer = by(STUDY_PARTS.prayer);
  const explore = parts.sections.filter(s => s !== understanding && s !== questions && s !== prayer && s.heading);
  const qs = questions ? mdBlocks(questions.text).flatMap(b => b.items || [b.text]) : [];
  const lectio = c.mode === 'lectio';
  const reflection = el('textarea', { class: 'st-reflect', rows: 6, placeholder: 'Begin your reflection…', 'aria-label': 'Your reflection', oninput: e => { study.reflection = e.target.value; } });
  reflection.value = study.reflection || '';
  const saveBtn = el('button', { type: 'button', class: 'btn-ink', onclick: () => saveStudy(saveBtn) }, c.entryId ? 'Save again to my journal' : 'Save to my journal');

  body.replaceChildren(el('article', { class: 'st-card' },
    el('button', { type: 'button', class: 'btn-link st-back', onclick: () => studyGo('start') }, '‹ New study'),
    studyHeader(modeLabel, parts.title || c.title, c.label),
    el('figure', { class: 'quote-card verse st-passage' }, el('blockquote', {}, c.passageText), el('figcaption', {}, 'World English Bible')),
    understanding ? el('section', { class: 'st-lead' }, el('h3', {}, STUDY_PARTS.understanding), ...mdNodes(understanding.text, showSource)) : null,
    explore.length ? el('section', { class: 'st-explore' }, el('h3', {}, lectio ? 'Pray with the passage' : 'Explore today’s reading'),
      ...explore.map(s => el('details', { class: 'st-part', open: lectio }, el('summary', {}, s.heading), el('div', { class: 'st-part-body' }, ...mdNodes(s.text, showSource))))) : null,
    prayer ? el('figure', { class: 'quote-card prayer st-prayer' }, el('p', { class: 'q-title' }, STUDY_PARTS.prayer), el('blockquote', {}, prayer.text.replace(/\*\*?/g, ''))) : null,
    qs.length ? el('section', { class: 'st-question' },
      el('h3', {}, 'A question for your journal'),
      el('p', { class: 'st-q' }, ...mdInline(qs[0])),
      qs.length > 1 ? el('ul', { class: 'st-q-more' }, ...qs.slice(1).map(q => el('li', {}, ...mdInline(q)))) : null,
      reflection,
      el('div', { class: 'st-actions' }, saveBtn,
        c.entryId ? el('button', { type: 'button', class: 'btn-plain', onclick: () => { setMode('journal'); openEntry(c.entryId); } }, 'Open in journal') : null)) : null,
    drawStudySources(c.sources, showSource),
    drawAsk(c),
    el('p', { class: 'st-foot' }, `Written with AI (${c.model}) from the sources above. `,
      c.flags && c.flags.length ? `${checkSummary(c.flags)} ` : 'Quotations and Greek and Hebrew words were checked against the sources. ',
      c.usage && c.usage.cost ? `Cost about ${(c.usage.cost * 100).toFixed(2)}¢.` : '')));
}
function checkSummary(flags) {
  const n = k => flags.filter(f => f.kind === k).length;
  const bits = [];
  if (n('quote')) bits.push(`${plural(n('quote'), 'quotation')} couldn’t be found in the sources, so ${n('quote') === 1 ? 'it’s' : 'they’re'} shown without quotation marks`);
  if (n('word')) bits.push(`${plural(n('word'), 'Greek or Hebrew word')} wasn’t in the sources and ${n('word') === 1 ? 'is' : 'are'} marked`);
  if (n('label')) bits.push('a reference to a missing source was removed');
  if (n('questions')) bits.push('the journal questions were rewritten to keep them open');
  return bits.length ? `Checked: ${bits.join('; ')}.` : 'Quotations and Greek and Hebrew words were checked against the sources.';
}

const WHY = { verses: 'On these verses', meaning: 'Close in meaning', words: 'Shares words' };
function sourceRow(src, n, { bookmarks } = {}) {
  const marked = bookmarks && bookmarks.has(src.id);
  const star = el('button', { type: 'button', class: 'st-star' + (marked ? ' on' : ''), title: marked ? 'Remove bookmark' : 'Bookmark', 'aria-pressed': String(!!marked),
    onclick: async e => { e.preventDefault(); const on = !star.classList.contains('on'); try { await api.studyBookmark(src, on); star.classList.toggle('on', on); star.setAttribute('aria-pressed', String(on)); toast(on ? 'Bookmarked' : 'Bookmark removed'); } catch (x) { toast(x.message); } } }, '★');
  return el('details', { class: 'st-src', id: n ? `st-src-${n}` : null },
    el('summary', {}, n ? el('span', { class: 'st-n' }, String(n)) : null,
      el('span', { class: 'st-src-t' }, el('b', {}, src.author), ', ', el('i', {}, src.work), src.year ? ` (${src.year})` : '', src.section ? el('small', {}, src.section) : null),
      src.why ? el('span', { class: 'st-why' }, WHY[src.why] || '') : null, star),
    el('div', { class: 'st-src-body' }, ...String(src.text).split(/\n{2,}/).map(t => el('p', {}, t)),
      el('p', { class: 'q-copy' }, src.credit || '', src.licence === 'public-domain' ? ' · Public domain' : '', src.url ? ' · ' : '', src.url ? el('button', { type: 'button', class: 'btn-link small', onclick: () => api.openExternal(src.url) }, 'Source') : null)));
}
function drawStudySources(list, _show) {
  const box = el('section', { class: 'st-sources' }, el('h3', {}, 'Sources'));
  if (!list || !list.length) { box.append(el('p', { class: 'st-small' }, 'No commentary was found for this passage, so the study keeps to the text itself.')); return box; }
  api.studyBookmarks().then(bm => { const set = new Set(bm.map(b => b.id)); box.querySelectorAll('.st-star').forEach((s, i) => { if (set.has(list[i].id)) s.classList.add('on'); }); }).catch(() => {});
  box.append(...list.map((s, i) => sourceRow(s, i + 1)));
  return box;
}

const ASK_IDEAS = ['What would this have meant to its first hearers?', 'What does the original Greek suggest?', 'How have different Christian traditions understood this?',
  'What does this say about justice?', 'What might this mean for leadership?', 'How might I live this today?'];
function drawAsk(c) {
  const thread = el('div', { class: 'st-thread' }, ...(c.thread || []).map(t => t.role === 'user' ? el('p', { class: 'st-you' }, t.content) : el('div', { class: 'st-ans' }, ...mdNodes(t.content))));
  const input = el('textarea', { class: 'st-input', rows: 2, placeholder: 'Ask about this passage…', maxlength: 1500,
    onkeydown: e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } } });
  const send = el('button', { type: 'button', class: 'btn-plain', onclick: () => ask() }, 'Ask');
  const ask = async q => {
    q = (q || input.value).trim();
    if (!q || study.asking) return;
    if (!study.status.key) { toast('Add an OpenRouter key in Settings → Bible study first'); return; }
    input.value = '';
    const live = el('div', { class: 'st-ans', id: 'stAnswerLive' }, el('p', { class: 'st-small st-pulse' }, 'Looking in the sources…'));
    thread.append(el('p', { class: 'st-you' }, q), live);
    study.asking = { rid: 'ask-' + Date.now(), text: '' };
    send.disabled = true;
    try {
      const r = await api.studyAsk(c.id, q, study.asking.rid);
      live.removeAttribute('id');
      live.replaceChildren(...mdNodes(r.answer), r.sources.length ? el('p', { class: 'q-copy' }, 'From: ', r.sources.map(s => `${s.author}, ${s.work}`).join('; ')) : null);
      c.thread = [...(c.thread || []), { role: 'user', content: q }, { role: 'assistant', content: r.answer }];
    } catch (x) { live.replaceChildren(el('p', { class: 'rv-note warn' }, x.message)); }
    finally { study.asking = false; send.disabled = false; }
  };
  return el('section', { class: 'st-ask' }, el('h3', {}, 'Ask about this passage'), thread,
    el('div', { class: 'st-chips' }, ...ASK_IDEAS.map(q => el('button', { type: 'button', class: 'st-chip', onclick: () => ask(q) }, q))),
    el('div', { class: 'st-row' }, input, send));
}

/** The study as a journal entry: your reflection first, then the study, its sources and credits. */
function studyHtml(c, reflection) {
  const parts = mdSplit(c.md);
  const modeLabel = ((study.status.modes || []).find(m => m.id === c.mode) || {}).label || 'Bible study';
  const mine = String(reflection || '').trim();
  return [
    mine ? `<h3>My reflection</h3>${mine.split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}<hr>` : '',
    `<p><small>${esc(modeLabel)} · ${esc(c.label)}</small></p>`,
    `<blockquote>${esc(c.passageText).replace(/\n/g, '<br>')}<br>— ${esc(c.label)} (World English Bible)</blockquote>`,
    ...parts.sections.filter(s => s.heading).map(s => `<h3>${esc(s.heading)}</h3>${mdHtml(s.text)}`),
    c.sources.length ? `<h3>Sources</h3><ol>${c.sources.map(s => `<li>${esc(s.author)}, <em>${esc(s.work)}</em>${s.year ? ` (${s.year})` : ''}${s.section ? `, ${esc(s.section)}` : ''}. ${esc(s.credit || '')}${s.licence === 'public-domain' ? ' Public domain.' : ''}</li>`).join('')}</ol>` : '',
    `<p><small>Written with AI (${esc(c.model)}) from these sources, ${esc(new Date(c.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))}.</small></p>`,
  ].join('');
}
async function saveStudy(btn) {
  const c = study.current;
  btn.disabled = true;
  try {
    const meta = await api.studySave(c.id, { html: studyHtml(c, study.reflection), reflection: study.reflection || '' });
    c.entryId = meta.id;
    state.metas = await api.list();
    try { state.categories = await api.getCategories(); } catch {}
    renderSidebar();
    toast('Saved to your journal, under Bible study');
    studyRedraw();
  } catch (x) { toast(x.message); btn.disabled = false; }
}

/* ---------- what the sources say (no AI) ---------- */
async function drawSources(body) {
  const p = study.passage;
  body.replaceChildren(el('div', { class: 'st-start' }, el('p', { class: 'st-small st-pulse' }, 'Looking in the library…')));
  let r;
  try { r = await api.studySources({ ref: p.ref, topic: p.topic || '' }); } catch (x) { body.replaceChildren(el('p', { class: 'rv-note warn' }, x.message)); return; }
  let bm = new Set(); try { bm = new Set((await api.studyBookmarks()).map(b => b.id)); } catch {}
  const on = r.sources.filter(s => s.why === 'verses'), rest = r.sources.filter(s => s.why !== 'verses');
  body.replaceChildren(el('div', { class: 'st-start' },
    el('button', { type: 'button', class: 'btn-link st-back', onclick: () => studyGo('passage') }, '‹ ' + p.label),
    studyHeader('What the sources say', p.label, `${plural(r.sources.length, 'passage')} from the library`),
    el('figure', { class: 'quote-card verse st-passage' }, el('blockquote', {}, p.passageText), el('figcaption', {}, 'World English Bible')),
    on.length ? el('section', { class: 'st-sources' }, el('h3', {}, 'On these verses'), ...on.map(s => sourceRow(s, 0, { bookmarks: bm }))) : el('p', { class: 'st-small' }, 'No commentary in the library is tagged with these verses.'),
    rest.length ? el('section', { class: 'st-sources' }, el('h3', {}, 'Related'), ...rest.map(s => sourceRow(s, 0, { bookmarks: bm }))) : null,
    studyLibraryNote()));
}

/* ---------- your studies, bookmarks and prayer list ---------- */
async function drawHistory(body) {
  let list = [];
  try { list = await api.studyHistory(); } catch (x) { toast(x.message); }
  const modes = Object.fromEntries((study.status.modes || []).map(m => [m.id, m.label]));
  body.replaceChildren(el('div', { class: 'st-start' },
    el('button', { type: 'button', class: 'btn-link st-back', onclick: () => studyGo('start') }, '‹ Bible study'),
    el('h2', { class: 'st-h' }, 'Your studies'),
    list.length ? el('div', { class: 'bv-list st-hist' }, ...list.map(h => el('div', { class: 'bv-row', role: 'button', tabindex: 0,
      onclick: async () => { try { study.current = await api.studyGet(h.id); study.reflection = ''; studyGo('study'); } catch (x) { toast(x.message); } } },
      el('b', {}, h.title), el('span', {}, `${h.label} · ${modes[h.mode] || ''} · ${new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${h.entryId ? ' · saved' : ''}`))))
      : el('p', { class: 'st-small' }, 'Studies you write appear here. The last 50 are kept, encrypted with your journal.'),
    list.length ? el('button', { type: 'button', class: 'btn-link danger', onclick: async () => {
      if (await confirmDialog({ title: 'Clear your study history?', text: 'Studies you saved to your journal stay there. The others are deleted from this list.', ok: 'Clear', danger: true })) { await api.studyClearHistory(); studyRedraw(); }
    } }, 'Clear history') : null));
}

async function studyBookmarksDialog() {
  let list = [];
  try { list = await api.studyBookmarks(); } catch (x) { toast(x.message); return; }
  openDialog((f, done) => {
    f.classList.add('page');
    f.append(el('h2', {}, 'Bookmarks'),
      list.length ? el('div', {}, ...list.map(b => sourceRow({ ...b, why: '' }, 0, { bookmarks: new Set(list.map(x => x.id)) })))
        : el('p', {}, 'Bookmark a passage from any source with ★ and it’s kept here.'),
      el('div', { class: 'btns' }, el('button', { type: 'button', class: 'btn-ink', onclick: () => done() }, 'Done')));
  });
}

let studyPrayersRefresh = null;
if (api.onSyncChanged) api.onSyncChanged(r => { if (r && r.study && studyPrayersRefresh) studyPrayersRefresh(); });
async function studyPrayerList() {
  let list = [];
  try { list = await api.studyPrayers(); } catch (x) { toast(x.message); return; }
  openDialog((f, done) => {
    f.classList.add('page');
    const box = el('div', { class: 'st-prayers' });
    const save = async () => { try { list = await api.studySetPrayers(list); } catch (x) { toast(x.message); } draw(); };
    // A change from another device while the list is open: show it.
    studyPrayersRefresh = async () => { if (!box.isConnected) { studyPrayersRefresh = null; return; } try { list = await api.studyPrayers(); draw(); } catch {} };
    const input = el('input', { type: 'text', class: 'st-input', placeholder: 'Someone or something to pray for', maxlength: 1000,
      onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
    const add = () => { const t = input.value.trim(); if (!t) return; list = [{ id: 'p' + Date.now().toString(36), text: t, note: '', at: todayISO(), done: '' }, ...list]; input.value = ''; save(); };
    const draw = () => box.replaceChildren(...(list.length ? list.map(p => {
      const c = el('input', { type: 'checkbox', title: 'Answered or done', onchange: e => { p.done = e.target.checked ? todayISO() : ''; save(); } }); c.checked = !!p.done;
      return el('div', { class: 'st-prow' + (p.done ? ' done' : '') }, c, el('span', {}, p.text, el('small', {}, fmt(p.at, { day: 'numeric', month: 'short' }), p.done ? ` · answered ${fmt(p.done, { day: 'numeric', month: 'short' })}` : '')),
        el('button', { type: 'button', class: 'btn-link small', onclick: () => { list = list.filter(x => x !== p); save(); } }, 'Remove'));
    }) : [el('p', { class: 'st-small' }, 'A private list, kept encrypted in your journal.')]));
    f.append(el('h2', {}, 'Prayer list'), el('div', { class: 'st-row' }, input, el('button', { type: 'button', class: 'btn-plain', onclick: add }, 'Add')), box,
      el('div', { class: 'btns' }, el('button', { type: 'button', class: 'btn-ink', onclick: () => done() }, 'Done')));
    draw();
  });
}

/* ---------- Settings → Bible study ---------- */
async function renderStudySettings(box, reopen) {
  let s;
  try { s = await api.studyStatus(); } catch (x) { box.replaceChildren(el('p', {}, x.message)); return; }
  const row = (label, help, control) => el('div', { class: 'row' }, el('div', {}, label, help ? el('small', {}, help) : null), control);
  const check = (val, on) => { const c = el('input', { type: 'checkbox', onchange: e => on(e.target.checked) }); c.checked = val; return c; };
  const set = async patch => { await updateSetting(patch); };

  // key. Results show here, under the box: Settings sits above the page, so a toast would be hidden behind it.
  const keyNote = el('p', { class: 'st-keynote', role: 'status', 'aria-live': 'polite' });
  const say = (text, warn) => { keyNote.textContent = text; keyNote.classList.toggle('warn', !!warn); };
  const keyInput = el('input', { type: 'password', class: 'st-input', placeholder: 'sk-or-v1-…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'OpenRouter key',
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } } });
  const saveBtn = el('button', { type: 'button', class: 'btn-ink', onclick: () => saveKey() }, 'Save');
  const saveKey = async () => {
    if (!keyInput.value.trim()) { say('Paste your key into the box first.', true); keyInput.focus(); return; }
    saveBtn.disabled = true; say('Checking your key with OpenRouter…');
    try { await api.studySetKey(keyInput.value); toast('Key saved'); renderStudySettings(box, reopen); }
    catch (x) { say(x.message, true); diag('Bible study key not saved: ' + x.message); saveBtn.disabled = false; }
  };
  const keyRow = s.key
    ? el('div', { class: 'row st-keyrow' }, el('div', {}, 'OpenRouter key', el('small', {}, 'Saved on this device only, protected by ' + (ANDROID ? 'Android' : 'Windows') + '.')),
      el('div', { class: 'btns' },
        el('button', { type: 'button', class: 'btn-plain', onclick: async () => {
          say('Asking OpenRouter…');
          const a = await api.studyAccount();
          say(a.error || (a.limit != null ? `Used $${a.usage.toFixed(2)} of this key’s $${a.limit.toFixed(2)} limit.` : `Used $${(a.usage || 0).toFixed(2)} in all with this key.`), !!a.error);
        } }, 'Check credit'),
        el('button', { type: 'button', class: 'btn-link danger', onclick: async () => { await api.studyForgetKey(); renderStudySettings(box, reopen); } }, 'Remove')),
      keyNote)
    : el('div', { class: 'row st-keyrow' }, el('div', {}, 'OpenRouter key', el('small', {}, 'Create one at openrouter.ai, add a few dollars of credit, and paste it here. It’s kept on this device only.')),
      el('div', { class: 'st-row' }, keyInput, saveBtn),
      el('button', { type: 'button', class: 'btn-link small', onclick: () => api.openExternal('https://openrouter.ai/keys') }, 'Get a key'),
      keyNote);

  // model
  const known = s.models.some(m => m.id === s.model);
  const custom = el('input', { type: 'text', class: 'st-input', placeholder: 'provider/model', value: known ? '' : s.model, hidden: known,
    onchange: e => set({ studyModel: e.target.value.trim() }) });
  const model = el('select', { onchange: e => { if (e.target.value === '*') { custom.hidden = false; custom.focus(); } else { custom.hidden = true; set({ studyModel: e.target.value }); } } },
    ...s.models.map(m => el('option', { value: m.id }, m.name)), el('option', { value: '*' }, 'Another model…'));
  model.value = known ? s.model : '*';
  const modelNote = (s.models.find(m => m.id === s.model) || {}).note || 'Any model on openrouter.ai, by its name.';

  const mode = el('select', { onchange: e => set({ studyMode: e.target.value }) }, ...s.modes.map(m => el('option', { value: m.id }, m.label))); mode.value = s.mode;
  const length = el('select', { onchange: e => set({ studyLength: e.target.value }) }, ...s.lengths.map(l => el('option', { value: l.id }, `${l.label} (about ${l.words} words)`))); length.value = s.length;

  // library
  const lib = el('div', { class: 'st-lib' });
  const drawLib = async () => {
    lib.replaceChildren(el('p', { class: 'st-small' }, 'Checking the library…'));
    const have = (await api.studyStatus()).library;
    let offer = null;
    try { offer = await api.studyOffer(); } catch (x) { offer = { error: x.message, packs: [] }; }
    const mb = n => `${(n / 1048576).toFixed(n > 10 * 1048576 ? 0 : 1)} MB`;
    const rows = [];
    for (const p of offer.packs) {
      const size = p.files.reduce((n, f) => n + (f.size || 0), 0);
      const btn = p.current ? el('button', { type: 'button', class: 'btn-link small', onclick: async () => { await api.studyRemovePack(p.id); drawLib(); } }, 'Remove')
        : el('button', { type: 'button', class: 'btn-plain', onclick: async e => {
          e.target.disabled = true; e.target.textContent = 'Starting…';
          studyDownloading = { pack: p.id, label: e.target };
          let msg = '';
          try { await api.studyDownload(p.id); toast(`${p.name} downloaded`); } catch (x) { msg = x.message; diag('Bible study library download: ' + x.message); }
          studyDownloading = null; await drawLib();
          if (msg) lib.prepend(el('p', { class: 'st-keynote warn', role: 'status' }, `${p.name}: ${msg}`));
        } }, p.installed ? `Update (${mb(size)})` : `Download (${mb(size)})`);
      rows.push(row(p.name, p.about, btn));
    }
    for (const p of have.filter(h => h.builtin)) rows.push(row(p.name, `${plural(p.passages, 'passage')}, built into WellWrite.`, el('span', { class: 'st-small' }, 'Included')));
    lib.replaceChildren(...rows, offer.error ? el('p', { class: 'rv-note warn' }, offer.error) : null);
  };

  box.replaceChildren(
    keyRow,
    row('Model', modelNote, el('div', {}, model, custom)),
    row('Usually write', 'You can choose for each study too.', el('div', { class: 'btns' }, mode, length)),
    row('Only use hosts that keep nothing', 'Asks OpenRouter to send your requests only to hosts that don’t store or train on them. A few models have no such host; turn this off to use them.',
      check(s.privateHosts, v => set({ studyPrivateHosts: v }))),
    row('Let Bible study read my journal', 'For Personal Reflection and “Reflect on this”. Entries are matched on this device; before anything is sent you see the exact words and choose which to share. Off by default.',
      check(s.journal, v => set({ studyJournal: v }))),
    row('This month', `${plural(s.month.requests, 'request')} from this device.`, el('span', {}, `about $${s.month.usd.toFixed(2)}`)),
    el('h3', {}, 'The library'),
    el('p', { class: 'set-intro' }, 'Public-domain commentaries and classics, downloaded once and searched on this device. Robertson’s volumes on John, Hebrews, the General Epistles and Revelation are left out while they’re still in copyright in the United States.'),
    lib,
    el('h3', {}, 'Your studies'),
    row('Study history', 'The last 50 studies, encrypted with your journal. Studies saved to your journal stay there.',
      el('button', { type: 'button', class: 'btn-link danger', onclick: async () => {
        if (await confirmDialog({ title: 'Clear your study history?', text: 'Studies you saved to your journal stay there.', ok: 'Clear', danger: true })) { await api.studyClearHistory(); toast('Study history cleared'); }
      } }, 'Clear')));
  drawLib();
}
let studyDownloading = null;
if (api.onStudyDownload) api.onStudyDownload(p => {
  if (studyDownloading && studyDownloading.pack === p.pack && studyDownloading.label.isConnected) {
    studyDownloading.label.textContent = p.total ? `${Math.round((p.done / p.total) * 100)}%` : `${(p.done / 1048576).toFixed(1)} MB`;
  }
});

/* ---------- from an entry: "Reflect in Bible study" (only when you've allowed Bible study to read your journal) ---------- */
function updateStudyButton() {
  const b = $('#studyBtn');
  if (!b) return;
  const c = state.current;
  b.hidden = !(state.settings && state.settings.studyJournal) || !c || !c.id || c.category === 'bible-study';
}
$('#studyBtn').addEventListener('click', async () => {
  const c = state.current;
  if (!c || !c.id) return;
  try { await saveNow(); } catch {}
  let ex;
  try { ex = await api.studyEntryExcerpt(c.id); } catch (x) { toast(x.message); return; }
  if (!ex.excerpt.trim()) { toast('Write a little more first'); return; }
  // Shown before anything leaves this device: these words, and only these, are sent.
  const ok = await openDialog((f, done) => {
    f.append(el('h2', {}, 'Share these words with the AI?'),
      el('p', {}, 'To choose a passage and shape a reflection, WellWrite will send these words from your entry to the AI model you chose, through OpenRouter. Nothing else from your journal is sent.'),
      el('blockquote', { class: 'st-share' }, ex.excerpt),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn-plain', onclick: () => done(false) }, 'Cancel'),
        el('button', { type: 'button', class: 'btn-ink', autofocus: true, onclick: () => done(true) }, 'Share and continue')));
  });
  if (!ok) return;
  toast('Finding a passage…');
  await studyPassage({ kind: 'entry', id: c.id, excerpt: ex.excerpt });
  if (!study.passage) return;
  study.mode = 'personal';
  study.journal = [{ id: c.id, date: c.date, title: c.title || '', excerpt: ex.excerpt, on: true }];
  studyRedraw();
});
