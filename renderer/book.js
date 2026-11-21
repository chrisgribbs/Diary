'use strict';
/* global api, el, $, toast, fmt, clean, state, bibleTr, bibleBooksList, versionButton, setMode, ANDROID, DOMPurify, ALLOWED */
/**
 * The Book section (Windows; Settings → General → "Write a book"): a writing project with a word goal and a due date.
 *   Overview: progress towards the goal, pace against the due date, and the chapter plan (titles, passages, outlines).
 *   Chapter:  the passage of John on the left, your writing on the right, saved as you type.
 * The engine keeps the book in the encrypted journal and syncs it (src/book.js, src/vault.js, src/sync.js).
 */
const bookState = {
  view: 'overview',   // overview | chapter
  data: null,         // { info, stats, chapters: [{ id, title, passage, outline, status, words, snippet }] }
  chapter: null,      // the chapter being written (with its html)
  editing: null,      // { form: 'details' | 'new' } on the overview
  saveTimer: 0, pending: null, saving: null,
  pane: 'passage',    // the left pane: passage | study
  studyId: '',        // a study open in the pane
  run: null,          // a study being written from here: { rid, text, phase, kind: 'study' | 'ask' }
};
const BOOK_STATUS = [['planned', 'Planned'], ['drafting', 'Drafting'], ['revising', 'Revising'], ['done', 'Done']];
const nf = n => Number(n || 0).toLocaleString();
const bookBox = () => $('#bookView');

async function renderBookView() {
  const box = bookBox();
  if (!box) return;
  try { bookState.data = await api.bookGet(); } catch (x) { box.replaceChildren(el('p', { class: 'rv-note warn' }, x.message)); return; }
  if (bookState.view === 'chapter' && bookState.chapter) return drawBookChapter(box);
  bookState.view = 'overview';
  drawBookOverview(box);
}
/** Another device's changes arrived: redraw the overview; a chapter open here is left as you have it. */
function bookOnSync() { if (bookState.view === 'overview') renderBookView(); }

// ---------- progress ----------
function progressBlock(st, info, { compact = false } = {}) {
  const pace = Math.min(100, 100 * st.expected / st.goal);
  const bar = el('div', { class: 'bk-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(st.goal), 'aria-valuenow': String(st.words), title: `${st.percent}% of ${nf(st.goal)} words` },
    el('span', { class: 'bk-fill', style: `width:${Math.min(100, st.percent)}%` }),
    st.daysLeft ? el('span', { class: 'bk-pace', style: `left:${pace}%`, title: `Where you’d be on an even pace: ${nf(st.expected)} words` }) : null);
  if (compact) return el('div', { class: 'bk-progress compact' }, el('span', { class: 'bk-mini' }, `${nf(st.words)} of ${nf(st.goal)}`), bar);
  const due = fmt(info.due, { day: 'numeric', month: 'long', year: 'numeric' });
  const where = st.words >= st.goal ? 'You’ve reached your goal. The draft is written.'
    : !st.daysLeft ? `Your due date (${due}) has passed: ${nf(st.goal - st.words)} words to go.`
    : st.ahead >= 0 ? `You’re ${nf(st.ahead)} words ahead of an even pace.`
    : `You’re ${nf(-st.ahead)} words behind an even pace. About ${nf(st.perDay)} a day from now gets you there by ${due}.`;
  return el('section', { class: 'bk-progress' },
    el('div', { class: 'bk-count' }, el('b', {}, nf(st.words)), el('span', {}, ` of ${nf(st.goal)} words`), el('span', { class: 'bk-pct' }, `${st.percent}%`)),
    bar,
    el('p', { class: 'bk-where' + (st.ahead < 0 && st.daysLeft ? ' behind' : '') }, where),
    el('div', { class: 'bk-stats' },
      stat(nf(st.today), 'today'), stat(nf(st.thisWeek), 'this week'),
      stat(st.daysLeft ? nf(st.perWeek) : '–', 'a week to finish'),
      stat(st.daysLeft ? `${Math.round(st.weeksLeft)}` : '0', `weeks to ${fmt(info.due, { day: 'numeric', month: 'short', year: 'numeric' })}`),
      stat(`${st.done}/${st.chapters}`, 'chapters done')));
}
const stat = (big, small) => el('div', { class: 'bk-stat' }, el('b', {}, big), el('small', {}, small));

// ---------- overview: progress, details, the chapter plan ----------
function drawBookOverview(box) {
  const { info, stats: st, chapters } = bookState.data;
  const form = bookState.editing && bookState.editing.form;
  box.replaceChildren(el('div', { class: 'bk-wrap' },
    el('header', { class: 'bk-head' },
      el('p', { class: 'bk-kicker' }, 'Your book'),
      el('h1', { class: 'bk-title' }, info.title),
      info.subtitle ? el('p', { class: 'bk-sub' }, info.subtitle) : null,
      el('div', { class: 'bk-actions' },
        el('button', { type: 'button', class: 'btn-ink', onclick: () => { bookState.editing = { form: 'new' }; drawBookOverview(box); setTimeout(() => { const i = $('#bkNewTitle'); if (i) i.focus(); }, 0); } }, '+ New chapter'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => { bookState.editing = form === 'details' ? null : { form: 'details' }; drawBookOverview(box); } }, 'Book details'),
        el('button', { type: 'button', class: 'btn-plain', disabled: !chapters.length, onclick: exportBook }, 'Export to Word'))),
    form === 'details' ? detailsForm(info, box) : null,
    progressBlock(st, info),
    form === 'new' ? newChapterForm(box) : null,
    el('section', { class: 'bk-plan' },
      el('h2', {}, 'Chapters'),
      chapters.length ? el('ol', { class: 'bk-list' }, ...chapters.map((c, i) => chapterRow(c, i, chapters.length, box)))
        : el('div', { class: 'bk-empty' },
          el('p', {}, 'Plan your book here. Give each chapter a working title, the passage of John it reflects on, and an outline of what you want to say. Then open a chapter to write with the passage beside you.'),
          el('p', { class: 'bk-hint' }, `${nf(info.goal)} words is about ${Math.round(info.goal / 2500)} chapters of 2,500 words, or ${Math.round(info.goal / 4000)} of 4,000.`)))));
}

function chapterRow(c, i, n, box) {
  const move = by => async e => { e.stopPropagation(); bookState.data = await api.bookMove(c.id, by); drawBookOverview(box); };
  let confirming = false;
  const remove = el('button', { type: 'button', class: 'bk-icon danger', title: 'Remove this chapter', onclick: async e => {
    e.stopPropagation();
    if (!confirming) { confirming = true; remove.textContent = `Remove${c.words ? ` (${nf(c.words)} words)` : ''}?`; remove.classList.add('ask'); setTimeout(() => { confirming = false; remove.textContent = '✕'; remove.classList.remove('ask'); }, 4000); return; }
    bookState.data = await api.bookRemoveChapter(c.id); drawBookOverview(box); toast(`Removed “${c.title || 'Untitled chapter'}”`);
  } }, '✕');
  return el('li', { class: 'bk-ch', tabindex: '0', onclick: () => openChapter(c.id), onkeydown: e => { if (e.key === 'Enter' && e.target === e.currentTarget) openChapter(c.id); } },
    el('span', { class: 'bk-num' }, String(i + 1)),
    el('div', { class: 'bk-ch-main' },
      el('div', { class: 'bk-ch-top' },
        el('b', { class: 'bk-ch-title' }, c.title || 'Untitled chapter'),
        c.passage ? el('span', { class: 'bk-ch-ref' }, c.passage) : null,
        el('span', { class: `bk-status s-${c.status}` }, (BOOK_STATUS.find(s => s[0] === c.status) || BOOK_STATUS[0])[1])),
      c.outline ? el('p', { class: 'bk-ch-outline' }, c.outline.length > 220 ? c.outline.slice(0, 220).trim() + '…' : c.outline)
        : c.snippet ? el('p', { class: 'bk-ch-outline quiet' }, c.snippet + '…') : null),
    el('div', { class: 'bk-ch-side' },
      el('span', { class: 'bk-ch-words' }, c.words ? `${nf(c.words)} words` : 'Not started'),
      el('span', { class: 'bk-ch-tools' },
        el('button', { type: 'button', class: 'bk-icon', title: 'Move up', disabled: i === 0, onclick: move(-1) }, '↑'),
        el('button', { type: 'button', class: 'bk-icon', title: 'Move down', disabled: i === n - 1, onclick: move(1) }, '↓'),
        remove)));
}

function newChapterForm(box) {
  const title = el('input', { id: 'bkNewTitle', placeholder: 'Working title, e.g. “The Word made flesh”', maxlength: '200' });
  const passage = el('input', { placeholder: 'Passage, e.g. John 1:1-18', maxlength: '120' });
  const outline = el('textarea', { rows: '4', placeholder: 'Outline: what this chapter will say, stories to tell, questions to explore…' });
  const add = async () => {
    const r = await api.bookAddChapter({ title: title.value, passage: passage.value, outline: outline.value });
    bookState.data = r.book; bookState.editing = null; drawBookOverview(box);
    toast('Chapter added to your plan');
  };
  return el('section', { class: 'bk-form' },
    el('h2', {}, 'New chapter'),
    el('label', {}, 'Title', title), el('label', {}, 'Passage of John', passage), el('label', {}, 'Outline and notes', outline),
    el('div', { class: 'bk-form-actions' },
      el('button', { type: 'button', class: 'btn-ink', onclick: add }, 'Add to the plan'),
      el('button', { type: 'button', class: 'btn-plain', onclick: () => { bookState.editing = null; drawBookOverview(box); } }, 'Cancel')));
}

function detailsForm(info, box) {
  const f = {
    title: el('input', { value: info.title, maxlength: '200' }),
    subtitle: el('input', { value: info.subtitle, maxlength: '300', placeholder: 'Optional' }),
    goal: el('input', { type: 'number', min: '1000', step: '1000', value: String(info.goal) }),
    start: el('input', { type: 'date', value: info.start }),
    due: el('input', { type: 'date', value: info.due }),
  };
  const save = async () => {
    bookState.data = await api.bookSetInfo({ title: f.title.value, subtitle: f.subtitle.value, goal: +f.goal.value, start: f.start.value, due: f.due.value });
    bookState.editing = null; drawBookOverview(box);
  };
  return el('section', { class: 'bk-form' },
    el('h2', {}, 'Book details'),
    el('label', {}, 'Title', f.title), el('label', {}, 'Subtitle', f.subtitle),
    el('div', { class: 'bk-form-row' }, el('label', {}, 'Word goal', f.goal), el('label', {}, 'Started', f.start), el('label', {}, 'Draft due', f.due)),
    el('div', { class: 'bk-form-actions' },
      el('button', { type: 'button', class: 'btn-ink', onclick: save }, 'Save'),
      el('button', { type: 'button', class: 'btn-plain', onclick: () => { bookState.editing = null; drawBookOverview(box); } }, 'Cancel')));
}

async function exportBook() {
  await bookFlush();
  try {
    const r = await api.bookExport();
    if (r) toast('Saved your book as ' + r.file.split(/[\\/]/).pop());
  } catch (x) { toast(x.message); }
}

// ---------- a chapter: John on the left, your writing on the right ----------
async function openChapter(id) {
  await bookFlush();
  const c = await api.bookChapter(id);
  if (!c) { toast('That chapter is no longer in the book.'); return renderBookView(); }
  bookState.chapter = c; bookState.view = 'chapter';
  bookState.ref = c.passage || 'John 1';
  renderBookView();
}

function drawBookChapter(box) {
  const c = bookState.chapter, st = bookState.data.stats, info = bookState.data.info;
  const saved = el('span', { class: 'bk-saved', id: 'bkSaved' }, 'Saved');
  const words = el('span', { class: 'bk-words', id: 'bkWords' }, `${nf(c.words)} words`);
  const title = el('input', { class: 'bk-ch-name', value: c.title, placeholder: 'Chapter title', maxlength: '200', oninput: () => queueSave({ title: title.value }) });
  const status = el('select', { class: 'bk-ch-status', onchange: () => queueSave({ status: status.value }, 0) }, ...BOOK_STATUS.map(([v, l]) => el('option', { value: v }, l)));
  status.value = c.status;
  const outline = el('textarea', { class: 'bk-outline', rows: '5', placeholder: 'Outline and notes for this chapter (not counted in your words)', oninput: () => queueSave({ outline: outline.value }) }, c.outline);
  const editor = el('div', { class: 'body bk-editor', id: 'bkEditor', contenteditable: 'true', spellcheck: 'true', 'aria-label': 'Chapter text', 'data-placeholder': 'Begin writing…' });
  editor.innerHTML = bookClean(c.html || '');
  editor.addEventListener('focus', () => {
    document.execCommand('defaultParagraphSeparator', false, 'p');
    if (!editor.textContent.trim() && !editor.querySelector('p, h2, h3, blockquote, li, hr')) {   // start with a paragraph, so the first line can take a style
      editor.innerHTML = '<p><br></p>';
      const r = document.createRange(); r.setStart(editor.firstChild, 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r);
    }
  });
  editor.addEventListener('blur', () => { if (editor.innerHTML === '<p><br></p>') editor.innerHTML = ''; });   // empty again: the placeholder shows
  editor.addEventListener('input', () => { queueSave({ html: bookClean(editor.innerHTML) }); words.textContent = `${nf(countLocal(editor))} words`; });
  editor.addEventListener('paste', e => {   // plain text, so pasted styles don't come in
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, t);
  });
  const page = el('div', { class: 'bk-page' }, editor);
  bookApplyLayout(page, info.layout);
  const { tools, panel } = bookToolbar(editor, page, words, saved, () => queueSave({ html: bookClean(editor.innerHTML) }));

  box.replaceChildren(el('div', { class: 'bk-desk' },
    el('div', { class: 'bk-deskbar' },
      el('button', { type: 'button', class: 'btn-link', onclick: async () => { await bookFlush(); bookState.view = 'overview'; bookState.chapter = null; renderBookView(); } }, '‹ All chapters'),
      title, status,
      el('span', { class: 'rd-gap' }),
      el('span', { id: 'bkProgress' }, progressBlock(st, info, { compact: true }))),
    el('div', { class: 'bk-split' },
      el('section', { class: 'bk-passage', 'aria-label': 'The passage and Bible study' },
        el('div', { class: 'bk-ptabs', role: 'tablist' },
          ...[['passage', 'Passage'], ['study', 'Study']].map(([k, l]) => el('button', { type: 'button', role: 'tab', class: 'bk-ptab' + (bookState.pane === k ? ' on' : ''), 'aria-selected': String(bookState.pane === k),
            onclick: () => { bookState.pane = k; document.querySelectorAll('.bk-ptab').forEach(b => { const on = b.textContent === l; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }); bookDrawPane(); } }, l))),
        el('div', { class: 'bk-pane', id: 'bkPassage' })),
      el('section', { class: 'bk-write' },
        el('details', { class: 'bk-outline-box', open: !c.html }, el('summary', {}, 'Outline and notes'), outline),
        tools, panel, page))));
  bookDrawPane();
  if (!c.html) setTimeout(() => editor.focus(), 50);
}
const countLocal = node => (node.innerText.match(/[^\s—–]+/g) || []).filter(w => /[A-Za-z0-9À-ɏ]/.test(w)).length;

const bookDrawPane = () => (bookState.pane === 'study' ? bookDrawStudy() : bookDrawPassage());

/** The passage pane: any reference (it starts at the chapter's), in your Bible version, the chosen verses marked. */
async function bookDrawPassage() {
  const pane = $('#bkPassage');
  if (!pane || bookState.pane !== 'passage') return;
  const c = bookState.chapter;
  const refInput = el('input', { class: 'bk-ref', value: bookState.ref, placeholder: 'e.g. John 3:1-21', 'aria-label': 'Passage to show',
    onkeydown: e => { if (e.key === 'Enter') { bookState.ref = refInput.value.trim() || 'John 1'; bookDrawPassage(); } } });
  const usePassage = c.passage && c.passage !== bookState.ref
    ? el('button', { type: 'button', class: 'btn-link', onclick: () => { bookState.ref = c.passage; bookDrawPassage(); } }, `Back to ${c.passage}`) : null;
  const setAsPassage = !c.passage || c.passage !== bookState.ref
    ? el('button', { type: 'button', class: 'btn-link', onclick: () => { c.passage = bookState.ref; queueSave({ passage: c.passage }, 0); bookDrawPassage(); } }, c.passage ? 'Use for this chapter' : 'Set as this chapter’s passage') : null;
  let p;
  try { p = await api.studyPick({ kind: 'ref', text: bookState.ref }); } catch { p = null; }
  if (!p || !p.ref) {
    pane.replaceChildren(el('div', { class: 'bk-pbar' }, refInput), el('p', { class: 'rv-note' }, 'Type a passage, such as John 3:16 or John 15, and press Enter.'));
    return;
  }
  const [b, c1, v1, c2, v2] = p.ref;
  try { if (!bibleBooksList) bibleBooksList = await api.bibleBooks(); } catch {}
  const books = bibleBooksList || [];
  const go = (bb, cc) => { bookState.ref = `${books[bb].name} ${cc}`; bookDrawPassage(); };
  const lastCh = Math.min(c2 || c1, c1 + 3);   // a long range shows up to four chapters
  const parts = [];
  let tr = '', copyright = '';
  for (let ch = c1; ch <= lastCh; ch++) {
    const data = await api.bibleChapter(bibleTr(), b, ch).catch(() => null);
    if (!data) continue;
    tr = data.translation; copyright = data.copyright || copyright;
    const inRange = v => v > 0 && (!v1 || ((ch > c1 || v >= v1) && (ch < (c2 || c1) || v <= (v2 || v1))));
    const art = el('article', { class: 'rd-text bk-text' }, el('h3', { class: 'bk-pch' }, `${books[b] ? books[b].name : ''} ${ch}`));
    for (const block of data.blocks) {
      if (block[0] === 'h') { art.append(el('p', { class: 'rd-head' }, block[1])); continue; }
      const wrap = el(block[0] === 'p' ? 'p' : 'div', { class: block[0] === 'p' ? 'rd-para' : 'rd-poem' });
      let last = null;
      for (const [v, t] of block[1]) {
        wrap.append(el('span', { class: (block[0] === 'p' ? 'rd-v' : 'rd-line rd-v') + (v1 && inRange(v) ? ' bk-on' : ''), 'data-v': v }, v > 0 && v !== last ? el('sup', {}, String(v)) : null, block[0] === 'p' ? t + ' ' : t));
        last = v;
      }
      art.append(wrap);
    }
    parts.push(art);
  }
  const prev = c1 > 1 ? [b, c1 - 1] : b > 0 && books[b - 1] ? [b - 1, books[b - 1].chapters] : null;
  const nextC = (c2 || c1);
  const next = books[b] && nextC < books[b].chapters ? [b, nextC + 1] : books[b + 1] ? [b + 1, 1] : null;
  pane.replaceChildren(...[
    el('div', { class: 'bk-pbar' },
      el('button', { type: 'button', class: 'rd-arrow', title: 'Previous chapter', disabled: !prev, onclick: () => prev && go(...prev) }, '‹'),
      refInput,
      el('button', { type: 'button', class: 'rd-arrow', title: 'Next chapter', disabled: !next, onclick: () => next && go(...next) }, '›'),
      tr ? el('span', { class: 'rd-ver' }, versionButton(tr)) : null),
    usePassage || setAsPassage ? el('div', { class: 'bk-plinks' }, usePassage, setAsPassage) : null,
    ...parts,
    copyright ? el('p', { class: 'rv-note' }, copyright) : null].filter(Boolean));   // replaceChildren would show a null as the word "null"
  const first = pane.querySelector('.bk-on');
  const scroller = pane.closest('.bk-passage');
  if (first && scroller) scroller.scrollTop = Math.max(0, first.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 110);
}

// ---------- the Study tab beside the page: Bible study on the passage, without leaving the chapter ----------
const refOverlaps = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a[0] !== b[0]) return false;
  const lo = r => r[1] * 1000 + (r[2] || 0), hi = r => (r[3] || r[1]) * 1000 + (r[4] || 999);
  return lo(a) <= hi(b) && lo(b) <= hi(a);
};
async function bookDrawStudy() {
  const pane = $('#bkPassage');
  if (!pane || bookState.pane !== 'study') return;
  const draw = (...kids) => { if (bookState.pane === 'study') pane.replaceChildren(el('div', { class: 'bk-study' }, ...kids.filter(Boolean))); };
  let status, p;
  try { [status, p] = await Promise.all([api.studyStatus(), api.studyPick({ kind: 'ref', text: bookState.ref })]); }
  catch (x) { return draw(el('p', { class: 'rv-note warn' }, x.message)); }
  const label = p && p.label ? p.label : bookState.ref;

  // A study being written (or a question being answered) from here
  if (bookState.run) {
    const r = bookState.run;
    return draw(el('p', { class: 'bk-skick' }, r.kind === 'ask' ? 'Answering your question' : `Writing a study of ${label}`),
      el('div', { class: 'bk-slive' }, ...mdNodes(r.text || '')),
      el('p', { class: 'st-small st-pulse bk-sphase' }, r.phase || 'Starting…'),
      el('button', { type: 'button', class: 'btn-plain', onclick: () => api.studyCancel(r.rid) }, 'Stop'));
  }
  // One study, open
  if (bookState.studyId) {
    const h = await api.studyGet(bookState.studyId).catch(() => null);
    if (!h) { bookState.studyId = ''; return bookDrawStudy(); }
    const body = el('div', { class: 'bk-sbody' });
    const parts = mdSplit(h.md);
    for (const sec of parts.sections) { if (sec.heading) body.append(el('h4', {}, sec.heading)); body.append(...mdNodes(sec.text)); }
    const thread = [];
    for (let i = 0; i < (h.thread || []).length; i += 2) {
      const q = h.thread[i], a = h.thread[i + 1];
      thread.push(el('div', { class: 'bk-sq' }, el('p', { class: 'bk-sq-q' }, q.content), a ? el('div', { class: 'bk-sq-a' }, ...mdNodes(a.content)) : null));
    }
    const ask = el('textarea', { rows: '2', placeholder: `Ask about ${h.label}… e.g. “What did this mean to its first hearers?”` });
    const works = [...new Set((h.sources || []).map(x => `${x.author}, ${x.work}`))];
    return draw(
      el('button', { type: 'button', class: 'btn-link', onclick: () => { bookState.studyId = ''; bookDrawStudy(); } }, '‹ Studies'),
      el('p', { class: 'bk-skick' }, `${(status.modes.find(m => m.id === h.mode) || {}).label || 'Bible study'} · ${h.label}`),
      el('h3', { class: 'bk-stitle' }, parts.title || h.title),
      el('div', { class: 'bk-sactions' },
        el('button', { type: 'button', class: 'btn-plain', title: 'Select some of the study first to add just that', onclick: () => addToNotes(h, body) }, 'Add to my notes'),
        el('span', { class: 'bk-hint2' }, 'Select text first to add only that.')),
      body,
      thread.length ? el('div', { class: 'bk-sthread' }, ...thread) : null,
      el('div', { class: 'bk-sask' }, ask,
        el('button', { type: 'button', class: 'btn-ink', onclick: () => askStudy(h, ask.value) }, 'Ask')),
      works.length ? el('p', { class: 'q-copy' }, 'From: ', works.join('; ')) : null);
  }
  // The list: write a new study, or open one already written on this passage
  if (!status.key) return draw(el('p', { class: 'bk-skick' }, `Bible study · ${label}`),
    el('p', {}, 'To write a study here, add your OpenRouter key in Settings → Bible study.'),
    el('button', { type: 'button', class: 'btn-plain', onclick: () => openSettings('study') }, 'Open Bible study settings'));
  const mode = el('select', {}, ...status.modes.map(m => el('option', { value: m.id }, m.label)));
  mode.value = status.modes.some(m => m.id === 'teaching') ? 'teaching' : status.modes[0].id;
  const length = el('select', {}, ...status.lengths.map(l => el('option', { value: l.id }, l.label)));
  length.value = status.length || 'standard';
  const mine = (await api.studyHistory().catch(() => [])).filter(x => p && refOverlaps(x.ref, p.ref));
  draw(
    el('p', { class: 'bk-skick' }, `Bible study · ${label}`),
    el('p', { class: 'bk-hint2' }, 'Study the passage beside your chapter. Studies are saved to Your studies in the Bible section too.'),
    el('div', { class: 'bk-snew' }, mode, length,
      el('button', { type: 'button', class: 'btn-ink', disabled: !p || !p.ref, onclick: () => writeBookStudy(p, mode.value, length.value) }, 'Write a study')),
    !status.hasPacks ? el('p', { class: 'rv-note' }, 'Tip: download the commentary library in Settings → Bible study for richer studies.') : null,
    el('h4', { class: 'bk-shead' }, mine.length ? `Your studies on ${label}` : `No studies on ${label} yet`),
    mine.length ? el('ul', { class: 'bk-slist' }, ...mine.map(x => el('li', {},
      el('button', { type: 'button', onclick: () => { bookState.studyId = x.id; bookDrawStudy(); } },
        el('b', {}, x.title), el('small', {}, `${(status.modes.find(m => m.id === x.mode) || {}).label || ''} · ${x.label} · ${fmt(x.at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}`))))) : null);
}

async function writeBookStudy(p, mode, length) {
  const rid = 'bk-' + Date.now();
  bookState.run = { rid, text: '', phase: '', kind: 'study' };
  bookDrawStudy();
  try {
    const got = await api.studyGenerate({ ref: p.ref, mode, length }, rid);
    api.studyJobSeen && api.studyJobSeen(rid);
    bookState.studyId = got.id;
  } catch (x) { if (!/Stopped/.test(x.message)) toast(x.message); }
  finally { if (bookState.run && bookState.run.rid === rid) bookState.run = null; bookDrawStudy(); }
}
async function askStudy(h, question) {
  question = String(question || '').trim();
  if (!question) return;
  const rid = 'bkq-' + Date.now();
  bookState.run = { rid, text: '', phase: 'Looking through the sources…', kind: 'ask' };
  bookDrawStudy();
  try { await api.studyAsk(h.id, question, rid); } catch (x) { if (!/Stopped/.test(x.message)) toast(x.message); }
  finally { if (bookState.run && bookState.run.rid === rid) bookState.run = null; bookDrawStudy(); }
}
/** The selected part of the study (or all of it) into the chapter's notes, with where it came from. */
function addToNotes(h, body) {
  const sel = getSelection();
  const picked = sel && !sel.isCollapsed && body.contains(sel.anchorNode) ? String(sel).trim() : '';
  const text = picked || body.innerText.trim();
  const note = `From the study “${h.title}” (${h.label}):\n${text}`;
  const box = document.querySelector('.bk-outline');
  const now = (bookState.chapter.outline || '').trim();
  const outline = now ? `${now}\n\n${note}` : note;
  if (box) { box.value = outline; const d = box.closest('details'); if (d) d.open = true; }
  queueSave({ outline }, 0);
  toast(picked ? 'Added the selection to your notes' : 'Added the study to your notes');
}
// Streaming into the pane (study.js listens too, for its own requests)
let bkLiveTimer = 0;
if (api.onStudyDelta) api.onStudyDelta((rid, piece) => {
  const r = bookState.run;
  if (!r || r.rid !== rid) return;
  r.text += piece;
  if (!bkLiveTimer) bkLiveTimer = setTimeout(() => { bkLiveTimer = 0; const n = document.querySelector('.bk-slive'); if (n && bookState.run) n.replaceChildren(...mdNodes(bookState.run.text)); }, 150);
});
if (api.onStudyPhase) api.onStudyPhase((rid, phase) => {
  const r = bookState.run;
  if (!r || r.rid !== rid) return;
  r.phase = phase;
  const n = document.querySelector('.bk-sphase'); if (n) n.textContent = phase;
});

// ---------- saving as you type ----------
function queueSave(patch, delay = 900) {
  if (!bookState.chapter) return;
  Object.assign(bookState.chapter, patch);
  bookState.pending = { ...(bookState.pending || {}), ...patch, id: bookState.chapter.id };
  const s = $('#bkSaved'); if (s) { s.textContent = 'Saving…'; s.classList.add('busy'); }
  clearTimeout(bookState.saveTimer);
  bookState.saveTimer = setTimeout(() => { bookFlush(); }, delay);
}
async function bookFlush() {
  clearTimeout(bookState.saveTimer);
  if (bookState.saving) await bookState.saving;
  const p = bookState.pending;
  if (!p) return;
  bookState.pending = null;
  const { id, ...patch } = p;
  bookState.saving = (async () => {
    try {
      const r = await api.bookSaveChapter(id, patch);
      if (bookState.data) bookState.data.stats = r.stats;
      const w = $('#bkWords'); if (w && bookState.chapter && bookState.chapter.id === id) w.textContent = `${nf(r.words)} words`;
      const pr = $('#bkProgress'); if (pr && bookState.data) pr.replaceChildren(progressBlock(r.stats, bookState.data.info, { compact: true }));
      const s = $('#bkSaved'); if (s) { s.textContent = 'Saved'; s.classList.remove('busy'); }
    } catch (x) {
      bookState.pending = { ...p, ...(bookState.pending || {}) };   // keep it, and say so
      const s = $('#bkSaved'); if (s) { s.textContent = 'Not saved'; s.classList.add('busy'); }
      toast('Your chapter couldn’t be saved: ' + x.message);
    } finally { bookState.saving = null; }
  })();
  await bookState.saving;
}
window.addEventListener('blur', () => { if (state.mode === 'book') bookFlush(); });
window.addEventListener('beforeunload', () => { bookFlush(); });


// ---------- formatting: the toolbar, and the book's page and text settings ----------
// Classes the editor may put on a paragraph; src/docx.js turns them into Word's alignment, indents and breaks.
const BK_CLASS = /^(al-[lcrj]|ind[1-4]|poem|pb)$/;
/** The journal's cleaning, keeping the book's paragraph classes (and nothing else). */
function bookClean(html) {
  const t = document.createElement('div');
  t.innerHTML = DOMPurify.sanitize(html, { ...ALLOWED, ALLOWED_ATTR: [...ALLOWED.ALLOWED_ATTR, 'class'] });
  t.querySelectorAll('[class]').forEach(n => {
    const keep = [...n.classList].filter(c => BK_CLASS.test(c));
    if (keep.length) n.className = keep.join(' '); else n.removeAttribute('class');
  });
  return t.innerHTML;
}

// The same choices as src/book.js (the engine checks them again).
const BK_FONTS = ['Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Book Antiqua', 'Cambria', 'Calibri', 'Arial'];
const BK_PAGES = { A4: [21, 'A4 (21 × 29.7 cm)'], Letter: [21.59, 'US Letter'], A5: [14.8, 'A5 (14.8 × 21 cm)'], '6x9': [15.24, 'Book, 6 × 9 in'] };
const BK_MARGINS = { narrow: [1.27, 'Narrow (1.27 cm)'], moderate: [1.9, 'Moderate (1.9 cm)'], normal: [2.54, 'Normal (2.54 cm)'], wide: [3.18, 'Wide (3.18 cm)'] };
const BK_LAYOUT = { font: 'Georgia', size: 12, line: 1.5, after: 8, indent: 0, justify: false, page: 'A4', margins: 'normal' };

/** Shows the writing as it will look in Word: the font, size, spacing, indent, and the page's text width. */
function bookApplyLayout(page, layout) {
  const L = { ...BK_LAYOUT, ...(layout || {}) };
  const v = (k, x) => page.style.setProperty(k, x);
  v('--bk-font', `"${L.font}", Georgia, serif`);
  v('--bk-size', L.size + 'pt');
  v('--bk-line', String(Math.round(L.line * 1.15 * 100) / 100));   // Word's "single" is about 1.15 of the type size
  v('--bk-after', L.after + 'pt');
  v('--bk-indent', L.indent + 'cm');
  v('--bk-pagew', BK_PAGES[L.page][0] + 'cm');
  v('--bk-margin', BK_MARGINS[L.margins][0] + 'cm');
  page.classList.toggle('justify', !!L.justify);
}

const bkIcon = (paths, w = 20) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', `0 0 ${w} 20`); s.setAttribute('aria-hidden', 'true'); s.innerHTML = paths; return s; };
const BK_ICONS = {
  l: '<path d="M3 5h14M3 9h9M3 13h14M3 17h9"/>', c: '<path d="M3 5h14M5.5 9h9M3 13h14M5.5 17h9"/>',
  r: '<path d="M3 5h14M8 9h9M3 13h14M8 17h9"/>', j: '<path d="M3 5h14M3 9h14M3 13h14M3 17h14"/>',
  out: '<path d="M9 5h8M9 9h8M9 13h8M3 17h14M6 8l-3 2.5L6 13"/>', in: '<path d="M9 5h8M9 9h8M9 13h8M3 17h14M3 8l3 2.5L3 13"/>',
  ul: '<circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="14" r="1.2"/><path d="M8 6h9M8 14h9"/>',
  ol: '<path d="M3 4.5h1.5v4M3 8.5h3M3 12.5c0-1 3-1 3 .3 0 1-3 1.6-3 3.2h3M9 6h8M9 14h8"/>',
  undo: '<path d="M7 5 3.5 8.5 7 12"/><path d="M4 8.5h8a4.5 4.5 0 0 1 0 9H8"/>', redo: '<path d="M13 5l3.5 3.5L13 12"/><path d="M16 8.5H8a4.5 4.5 0 0 0 0 9h4"/>',
  clear: '<path d="M5 4h10M10 4l-3 12M4 16l12-12"/>',
};

/** The blocks (paragraphs, headings, quotations, list items) the selection touches. */
function bkBlocks(editor) {
  const sel = getSelection();
  if (!sel.rangeCount || !editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return [];
  if ([...editor.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) document.execCommand('formatBlock', false, 'p');
  const r = getSelection().getRangeAt(0);
  let found = [...editor.children].filter(b => r.intersectsNode(b));
  if (!found.length) { let n = r.startContainer; while (n && n.parentNode !== editor) n = n.parentNode; if (n && n.nodeType === 1) found = [n]; }
  return found.flatMap(b => (/^(UL|OL)$/.test(b.tagName) ? [...b.children].filter(li => r.intersectsNode(li)) : [b])).filter(b => b.tagName !== 'HR');
}
const bkTidy = b => { if (!b.className.trim()) b.removeAttribute('class'); };
function bkAlign(editor, a) {
  const blocks = bkBlocks(editor);
  const same = blocks.length && blocks.every(b => b.classList.contains('al-' + a));
  for (const b of blocks) { b.classList.remove('al-l', 'al-c', 'al-r', 'al-j'); if (!same && a !== 'l') b.classList.add('al-' + a); bkTidy(b); }
}
function bkIndent(editor, by) {
  for (const b of bkBlocks(editor)) {
    const n = Math.max(0, Math.min(4, (+([...b.classList].find(c => /^ind\d$/.test(c)) || 'ind0').slice(3)) + by));
    b.classList.remove('ind1', 'ind2', 'ind3', 'ind4'); if (n) b.classList.add('ind' + n); bkTidy(b);
  }
}
/** The paragraph style of the block the cursor is in: p, poem, h2, h3 or blockquote. */
function bkStyleAt(editor) {
  const sel = getSelection();
  if (!sel.rangeCount) return 'p';
  let n = sel.anchorNode;
  while (n && n !== editor) { if (n.nodeType === 1) { const t = n.tagName.toLowerCase(); if (/^(h2|h3|blockquote)$/.test(t)) return t; if (t === 'p' && n.parentNode === editor) return n.classList.contains('poem') ? 'poem' : 'p'; } n = n.parentNode; }
  return 'p';
}
function bkSetStyle(editor, v) {
  if (v === 'poem' || v === 'p') {
    if (/^(h2|h3|blockquote)$/.test(bkStyleAt(editor))) document.execCommand('formatBlock', false, 'p');
    for (const b of bkBlocks(editor)) if (b.tagName === 'P') { b.classList.toggle('poem', v === 'poem'); bkTidy(b); }
  } else document.execCommand('formatBlock', false, v);
}

function bookToolbar(editor, page, words, saved, changed) {
  const act = fn => () => { editor.focus(); fn(); changed(); sync(); };
  const btn = (label, title, fn, key) => el('button', { type: 'button', class: 'bk-fmt', title, 'aria-label': title, 'data-k': key || '', onmousedown: e => e.preventDefault(), onclick: act(fn) }, label);
  const cmd = (c, v) => () => document.execCommand(c, false, v);
  const style = el('select', { class: 'bk-style', title: 'Paragraph style', 'aria-label': 'Paragraph style',
    onchange: () => { editor.focus(); bkSetStyle(editor, style.value); changed(); sync(); } },
    ...[['p', 'Body text'], ['h2', 'Heading'], ['h3', 'Subheading'], ['blockquote', 'Quotation'], ['poem', 'Poem or verse']].map(([v, l]) => el('option', { value: v }, l)));
  const sep = () => el('span', { class: 'bk-sep', 'aria-hidden': 'true' });
  const panel = bookLayoutPanel(page);
  const tools = el('div', { class: 'bk-tools', role: 'toolbar', 'aria-label': 'Formatting' },
    btn(bkIcon(BK_ICONS.undo), 'Undo (Ctrl+Z)', cmd('undo')), btn(bkIcon(BK_ICONS.redo), 'Redo (Ctrl+Y)', cmd('redo')), sep(),
    style, sep(),
    btn(el('b', {}, 'B'), 'Bold (Ctrl+B)', cmd('bold'), 'bold'), btn(el('i', {}, 'I'), 'Italic (Ctrl+I)', cmd('italic'), 'italic'),
    btn(el('u', {}, 'U'), 'Underline (Ctrl+U)', cmd('underline'), 'underline'), btn(el('s', {}, 'S'), 'Strikethrough', cmd('strikeThrough'), 'strikeThrough'),
    btn(el('span', {}, 'x', el('sup', {}, '2')), 'Superscript, for verse numbers and notes', cmd('superscript'), 'superscript'), sep(),
    btn(bkIcon(BK_ICONS.ul), 'Bulleted list', cmd('insertUnorderedList'), 'insertUnorderedList'), btn(bkIcon(BK_ICONS.ol), 'Numbered list', cmd('insertOrderedList'), 'insertOrderedList'), sep(),
    btn(bkIcon(BK_ICONS.l), 'Align left', () => bkAlign(editor, 'l'), 'al-l'), btn(bkIcon(BK_ICONS.c), 'Centre (Ctrl+E)', () => bkAlign(editor, 'c'), 'al-c'),
    btn(bkIcon(BK_ICONS.r), 'Align right', () => bkAlign(editor, 'r'), 'al-r'), btn(bkIcon(BK_ICONS.j), 'Justify (Ctrl+J)', () => bkAlign(editor, 'j'), 'al-j'),
    btn(bkIcon(BK_ICONS.out), 'Less indent (Shift+Tab)', () => bkIndent(editor, -1)), btn(bkIcon(BK_ICONS.in), 'More indent (Tab)', () => bkIndent(editor, 1)), sep(),
    btn('✱', 'Scene break: a centred * * * between sections', cmd('insertHTML', '<hr><p><br></p>')), btn('⤓', 'Page break: start a new page in Word', cmd('insertHTML', '<hr class="pb"><p><br></p>')),
    btn(bkIcon(BK_ICONS.clear), 'Clear formatting', () => { document.execCommand('removeFormat'); bkSetStyle(editor, 'p'); for (const b of bkBlocks(editor)) { b.removeAttribute('class'); } }), sep(),
    el('button', { type: 'button', class: 'bk-fmt bk-pageset', 'aria-expanded': 'false', title: 'Font, spacing, indents and page size, for the whole book and the Word export',
      onclick: e => { panel.hidden = !panel.hidden; e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden)); } }, 'Page & text'),
    el('span', { class: 'rd-gap' }), words, saved);
  // Show what's on where the cursor is.
  function sync() {
    if (!document.body.contains(editor)) { document.removeEventListener('selectionchange', sync); return; }
    if (!editor.contains(getSelection().anchorNode)) return;
    style.value = bkStyleAt(editor);
    const blocks = bkBlocks(editor);
    for (const b of tools.querySelectorAll('[data-k]')) {
      const k = b.dataset.k; if (!k) continue;
      let on = false;
      if (k.startsWith('al-')) on = blocks.length > 0 && blocks.every(x => (k === 'al-l' ? !/\bal-[crj]\b/.test(x.className) : x.classList.contains(k)));
      else try { on = document.queryCommandState(k); } catch {}
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    }
  }
  document.addEventListener('selectionchange', sync);
  editor.addEventListener('keydown', e => {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); act(() => bkIndent(editor, e.shiftKey ? -1 : 1))();
    } else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); act(() => bkAlign(editor, 'c'))(); }
    else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); act(() => bkAlign(editor, 'j'))(); }
  });
  return { tools, panel };
}

/** Page & text: the whole book's font, size, line and paragraph spacing, first-line indent, justification, page size and margins. */
function bookLayoutPanel(page) {
  const L = { ...BK_LAYOUT, ...((bookState.data && bookState.data.info.layout) || {}) };
  const sel = (key, opts, fmtV = v => v) => {
    const s = el('select', { 'data-key': key, onchange: () => save({ [key]: key === 'font' || key === 'page' || key === 'margins' ? s.value : +s.value }) },
      ...opts.map(([v, l]) => el('option', { value: String(v) }, l)));
    s.value = String(fmtV(L[key]));
    return s;
  };
  const justify = el('input', { type: 'checkbox', 'data-key': 'justify', onchange: () => save({ justify: justify.checked }) });
  justify.checked = !!L.justify;
  const note = el('span', { class: 'bk-lnote' });
  async function save(patch) {
    Object.assign(L, patch);
    bookApplyLayout(page, L);
    try { bookState.data = await api.bookSetInfo({ layout: patch }); note.textContent = 'Saved for the whole book'; setTimeout(() => { note.textContent = ''; }, 1800); }
    catch (x) { toast(x.message); }
  }
  const field = (label, control) => el('label', { class: 'bk-lfield' }, el('span', {}, label), control);
  return el('div', { class: 'bk-layout', hidden: true },
    field('Font', sel('font', BK_FONTS.map(f => [f, f]))),
    field('Size', sel('size', [9, 10, 10.5, 11, 11.5, 12, 13, 14, 16].map(n => [n, n + ' pt']))),
    field('Line spacing', sel('line', [[1, 'Single'], [1.15, '1.15'], [1.5, '1.5 lines'], [2, 'Double']])),
    field('Space after paragraphs', sel('after', [[0, 'None'], [4, '4 pt'], [6, '6 pt'], [8, '8 pt'], [12, '12 pt']])),
    field('First-line indent', sel('indent', [[0, 'None'], [0.5, '0.5 cm'], [0.75, '0.75 cm'], [1, '1 cm'], [1.27, '1.27 cm']])),
    field('Page size', sel('page', Object.entries(BK_PAGES).map(([k, [, l]]) => [k, l]))),
    field('Margins', sel('margins', Object.entries(BK_MARGINS).map(([k, [, l]]) => [k, l]))),
    el('label', { class: 'bk-lfield bk-lcheck' }, justify, el('span', {}, 'Justify body text')),
    el('p', { class: 'bk-lhint' }, 'These apply to every chapter, here and in Export to Word. A book usually has no space between paragraphs and a first-line indent instead; the first paragraph after a heading or break isn’t indented. ', note));
}
