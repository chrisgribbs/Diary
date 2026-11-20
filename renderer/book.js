'use strict';
/* global api, el, $, toast, fmt, clean, state, bibleTr, bibleBooksList, versionButton, setMode, ANDROID */
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
  editor.innerHTML = clean(c.html || '');
  editor.addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'p'));
  editor.addEventListener('input', () => { queueSave({ html: clean(editor.innerHTML) }); words.textContent = `${nf(countLocal(editor))} words`; });
  editor.addEventListener('paste', e => {   // plain text, so pasted styles don't come in
    e.preventDefault();
    const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    document.execCommand('insertText', false, t);
  });
  const fmtBtn = (label, title, fn) => el('button', { type: 'button', class: 'bk-fmt', title, onmousedown: e => e.preventDefault(), onclick: () => { editor.focus(); fn(); queueSave({ html: clean(editor.innerHTML) }); } }, label);
  const tools = el('div', { class: 'bk-tools' },
    fmtBtn(el('b', {}, 'B'), 'Bold (Ctrl+B)', () => document.execCommand('bold')),
    fmtBtn(el('i', {}, 'I'), 'Italic (Ctrl+I)', () => document.execCommand('italic')),
    fmtBtn('Heading', 'A heading within the chapter', () => document.execCommand('formatBlock', false, document.queryCommandValue('formatBlock') === 'h2' ? 'p' : 'h2')),
    fmtBtn('“ Quote', 'Set a quotation apart', () => document.execCommand('formatBlock', false, document.queryCommandValue('formatBlock') === 'blockquote' ? 'p' : 'blockquote')),
    fmtBtn('• List', 'A bulleted list', () => document.execCommand('insertUnorderedList')),
    el('span', { class: 'rd-gap' }), words, saved);

  box.replaceChildren(el('div', { class: 'bk-desk' },
    el('div', { class: 'bk-deskbar' },
      el('button', { type: 'button', class: 'btn-link', onclick: async () => { await bookFlush(); bookState.view = 'overview'; bookState.chapter = null; renderBookView(); } }, '‹ All chapters'),
      title, status,
      el('span', { class: 'rd-gap' }),
      el('span', { id: 'bkProgress' }, progressBlock(st, info, { compact: true }))),
    el('div', { class: 'bk-split' },
      el('section', { class: 'bk-passage', id: 'bkPassage', 'aria-label': 'The passage' }),
      el('section', { class: 'bk-write' },
        el('details', { class: 'bk-outline-box', open: !c.html }, el('summary', {}, 'Outline and notes'), outline),
        tools, editor))));
  bookDrawPassage();
  if (!c.html) setTimeout(() => editor.focus(), 50);
}
const countLocal = node => (node.innerText.match(/[^\s—–]+/g) || []).filter(w => /[A-Za-z0-9À-ɏ]/.test(w)).length;

/** The passage pane: any reference (it starts at the chapter's), in your Bible version, the chosen verses marked. */
async function bookDrawPassage() {
  const pane = $('#bkPassage');
  if (!pane) return;
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
  pane.replaceChildren(
    el('div', { class: 'bk-pbar' },
      el('button', { type: 'button', class: 'rd-arrow', title: 'Previous chapter', disabled: !prev, onclick: () => prev && go(...prev) }, '‹'),
      refInput,
      el('button', { type: 'button', class: 'rd-arrow', title: 'Next chapter', disabled: !next, onclick: () => next && go(...next) }, '›'),
      tr ? el('span', { class: 'rd-ver' }, versionButton(tr)) : null),
    usePassage || setAsPassage ? el('div', { class: 'bk-plinks' }, usePassage, setAsPassage) : null,
    ...parts,
    copyright ? el('p', { class: 'rv-note' }, copyright) : null);
  const first = pane.querySelector('.bk-on');
  if (first) first.scrollIntoView({ block: 'start' });
  pane.scrollTop = Math.max(0, pane.scrollTop - 60);
}

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
