'use strict';
/* Daybook — renderer */
const api = window.daybook;
const $ = s => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
  return n;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const dateOf = iso => new Date(iso + 'T00:00:00');
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmt = (iso, o) => dateOf(iso).toLocaleDateString(undefined, o);
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;

const ICON = {
  bold: '<span class="tb-text">B</span>',
  italic: '<span class="tb-text" style="font-style:italic;font-weight:500">I</span>',
  underline: '<span class="tb-text" style="text-decoration:underline;font-weight:500">U</span>',
  strike: '<span class="tb-text" style="text-decoration:line-through;font-weight:500">S</span>',
  h2: '<svg viewBox="0 0 20 20"><path d="M4 4v12M12 4v12M4 10h8M15 9.5c.6-.8 1.3-1.2 2-1 .8.3.9 1.2.4 2L15 15h3"/></svg>',
  quote: '<svg viewBox="0 0 20 20"><path d="M4 6h12M7 10h9M7 14h9M4 9.5v5.5"/></svg>',
  ul: '<svg viewBox="0 0 20 20"><circle cx="4.5" cy="6" r=".9" fill="currentColor"/><circle cx="4.5" cy="10" r=".9" fill="currentColor"/><circle cx="4.5" cy="14" r=".9" fill="currentColor"/><path d="M8 6h9M8 10h9M8 14h9"/></svg>',
  ol: '<svg viewBox="0 0 20 20"><path d="M3.5 4.5h1.3v3.5M3.4 8h2.6M3.5 12.2c.4-.6 1.8-.7 2 .1.2.8-2 1.7-2 2.7h2.2M8.5 6h8.5M8.5 10h8.5M8.5 14h8.5"/></svg>',
  mark: '<svg viewBox="0 0 20 20"><path d="M12.5 3.5l4 4-7 7H5.5v-4z"/><path d="M3 17.5h14"/></svg>',
  link: '<svg viewBox="0 0 20 20"><path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1"/></svg>',
  image: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.4"/><path d="M3.5 14.5l4-4 3 3 2-2 4 4"/></svg>',
  hr: '<svg viewBox="0 0 20 20"><circle cx="5" cy="10" r=".9" fill="currentColor"/><circle cx="10" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/></svg>',
  clear: '<svg viewBox="0 0 20 20"><path d="M5 5h10M10 5l-2.5 11M4 16l12-12"/></svg>',
  photo: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.4"/><path d="M3.5 14.5l4-4 3 3 2-2 4 4"/></svg>',
};

/* ---------- state ---------- */
const state = {
  metas: [],
  current: null,        // { id, date, time, title, tags, saved }
  dirty: false,
  viewMonth: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
  selectedDay: null,
  query: '',
  tag: null,
  settings: { autoLockMinutes: 10, lockOnMinimize: false, theme: 'system', fontSize: 19, spellcheck: true },
  lastActivity: Date.now(),
  unlocked: false,
  dataDir: '',
};

/* ---------- sanitising ---------- */
const ALLOWED = {
  ALLOWED_TAGS: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'hr', 'a', 'img', 'mark', 'sub', 'sup', 'code', 'pre', 'span'],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title'],
  ALLOW_DATA_ATTR: false,
};
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'IMG' && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(node.getAttribute('src') || '')) node.remove();
  if (node.tagName === 'A' && !/^(https?:|mailto:)/i.test(node.getAttribute('href') || '')) node.removeAttribute('href');
});
const clean = html => DOMPurify.sanitize(html, ALLOWED);
function cleanPaste(html) {
  // Turn big headings into our two levels before stripping.
  const tmp = document.createElement('div');
  tmp.innerHTML = DOMPurify.sanitize(html, { ...ALLOWED, ALLOWED_TAGS: [...ALLOWED.ALLOWED_TAGS, 'h1', 'h4', 'h5', 'h6'] });
  tmp.querySelectorAll('h1').forEach(h => h.replaceWith(el('h2', {}, h.textContent)));
  tmp.querySelectorAll('h4,h5,h6').forEach(h => h.replaceWith(el('h3', {}, h.textContent)));
  tmp.querySelectorAll('span').forEach(s => s.replaceWith(...s.childNodes));
  return tmp.innerHTML;
}

/* ---------- toast & dialogs ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function openDialog(build) {
  const dlg = $('#dlg');
  // Fresh form each time so old submit handlers never linger.
  const form = el('form', { method: 'dialog', id: 'dlgForm' });
  $('#dlgForm').replaceWith(form);
  return new Promise(resolve => {
    const done = v => { resolve(v); dlg.close(); };
    build(form, done);
    // The close event is async; ignore a stale one that lands after a new dialog opened.
    dlg.onclose = () => { if (!dlg.open) resolve(undefined); };
    dlg.showModal();
    const f = form.querySelector('[autofocus]');
    if (f) f.focus();
    else { const h = form.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus(); } }
  });
}

function confirmDialog({ title, text, ok, danger }) {
  return openDialog((f, done) => {
    f.append(el('h2', {}, title), el('p', {}, text),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn-plain', onclick: () => done(false) }, 'Cancel'),
        el('button', { type: 'button', class: danger ? 'btn-danger' : 'btn-ink', autofocus: true, onclick: () => done(true) }, ok)));
  });
}

function promptDialog({ title, text, label, type = 'text', value = '', ok }) {
  return openDialog((f, done) => {
    const input = el('input', { type, value, autofocus: true, spellcheck: 'false' });
    f.addEventListener('submit', e => { e.preventDefault(); done(input.value); });
    f.append(el('h2', {}, title), text ? el('p', {}, text) : null, el('label', { class: 'field' }, label, input),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn-plain', onclick: () => done(null) }, 'Cancel'),
        el('button', { type: 'submit', class: 'btn-ink' }, ok)));
  });
}

/* ---------- lock screen ---------- */
async function boot() {
  try { state.settings = await api.getSettings(); } catch {}
  applySettings();
  const s = await api.status();
  state.dataDir = s.dataDir;
  showLock(s.exists);
}

function showLock(exists) {
  state.unlocked = false;
  $('#app').hidden = true;
  $('#lock').hidden = false;
  $('#unlockForm').hidden = !exists;
  $('#setupForm').hidden = exists;
  $('#unlockErr').textContent = $('#setupErr').textContent = '';
  $('#unlockPw').value = $('#setupPw').value = $('#setupPw2').value = '';
  setTimeout(() => (exists ? $('#unlockPw') : $('#setupPw')).focus(), 50);
}

$('#unlockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#unlockBtn'), pw = $('#unlockPw').value;
  if (!pw) return;
  btn.disabled = true; btn.textContent = 'Opening…';
  try {
    if (await api.unlock(pw)) { $('#unlockPw').value = ''; await enterApp(); }
    else {
      $('#unlockErr').textContent = 'That password is not right. Try again.';
      $('.lock-card').classList.remove('shake'); void $('.lock-card').offsetWidth; $('.lock-card').classList.add('shake');
      $('#unlockPw').select();
    }
  } catch (err) { $('#unlockErr').textContent = err.message; }
  btn.disabled = false; btn.textContent = 'Open journal';
});

$('#setupForm').addEventListener('submit', async e => {
  e.preventDefault();
  const a = $('#setupPw').value, b = $('#setupPw2').value, err = $('#setupErr');
  if (a.length < 6) { err.textContent = 'Use at least 6 characters.'; return; }
  if (a !== b) { err.textContent = 'The two passwords do not match.'; return; }
  const btn = $('#setupBtn'); btn.disabled = true; btn.textContent = 'Creating…';
  try { await api.create(a); $('#setupPw').value = $('#setupPw2').value = ''; await enterApp(); }
  catch (x) { err.textContent = x.message; }
  btn.disabled = false; btn.textContent = 'Create journal';
});

$('#restoreFreshBtn').addEventListener('click', async () => {
  const file = await api.pickBackup();
  if (!file) return;
  const pw = await promptDialog({ title: 'Restore from backup', text: 'Enter the password that was used when this backup was made. It becomes your journal password.', label: 'Backup password', type: 'password', ok: 'Restore' });
  if (!pw) return;
  try { const n = await api.restoreFresh(file, pw); await enterApp(); toast(`Restored ${plainEntries(n)}`); }
  catch (x) { $('#setupErr').textContent = x.message; }
});

async function enterApp() {
  state.unlocked = true;
  state.lastActivity = Date.now();
  state.metas = await api.list();
  state.selectedDay = null; state.query = ''; state.tag = null; $('#search').value = '';
  const d = new Date(); state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  $('#lock').hidden = true;
  $('#app').hidden = false;
  const today = sorted(state.metas.filter(m => m.date === todayISO()))[0];
  if (today) await openEntry(today.id); else showEmpty();
  renderSidebar();
}

async function lockNow() {
  if (!state.unlocked) return;
  await saveNow();
  state.unlocked = false;
  try { await api.lock(); } catch {}
  // Wipe everything readable from the page.
  state.metas = []; state.current = null;
  $('#body').innerHTML = ''; $('#title').value = ''; $('#tagChips').replaceChildren();
  $('#list').replaceChildren(); $('#calGrid').replaceChildren(); $('#search').value = '';
  if ($('#dlg').open) $('#dlg').close();
  $('#lightbox').hidden = true;
  showLock(true);
}

/* ---------- entries: list + filtering ---------- */
const plainEntries = n => n === 1 ? '1 entry' : `${n.toLocaleString()} entries`;
const sorted = list => [...list].sort((a, b) => (b.date + b.time + b.created).localeCompare(a.date + a.time + a.created));

function matches(m) {
  if (state.selectedDay && m.date !== state.selectedDay) return false;
  if (state.tag && !m.tags.includes(state.tag)) return false;
  if (state.query) {
    const hay = (m.title + ' ' + m.tags.map(t => '#' + t).join(' ') + ' ' + m.text).toLowerCase();
    return terms().every(t => hay.includes(t));
  }
  return true;
}
const terms = () => state.query.toLowerCase().split(/\s+/).filter(Boolean);

function highlight(text) {
  let html = esc(text);
  for (const t of terms().map(t => t.replace(/^#/, ''))) {
    if (!t) continue;
    const re = new RegExp(esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    html = html.replace(re, x => `<mark>${x}</mark>`);
  }
  return html;
}

function excerpt(m) {
  const text = m.text.replace(/\s+/g, ' ').trim();
  if (!state.query) return esc(text.slice(0, 160));
  const lower = text.toLowerCase();
  const hit = terms().map(t => lower.indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0];
  if (hit == null) return esc(text.slice(0, 160));
  const start = Math.max(0, hit - 50);
  return (start ? '…' : '') + highlight(text.slice(start, start + 160));
}

function renderList() {
  const list = $('#list');
  const items = sorted(state.metas.filter(matches));
  list.replaceChildren();

  if (!items.length) {
    const box = el('div', { class: 'list-empty' });
    if (state.selectedDay) {
      box.append(`Nothing written on ${fmt(state.selectedDay, { day: 'numeric', month: 'long' })}. `);
      box.append(el('button', { class: 'btn-link', style: 'color:var(--foil)', onclick: () => newEntry(state.selectedDay) }, 'Write an entry for this day'));
    } else if (state.query || state.tag) box.textContent = 'No entries match. Try fewer words, or clear the filter.';
    else box.textContent = 'Your entries will appear here.';
    list.append(box);
    return;
  }

  let month = '';
  for (const m of items) {
    const mk = m.date.slice(0, 7);
    if (mk !== month) { month = mk; list.append(el('div', { class: 'list-month' }, fmt(m.date, { month: 'long', year: 'numeric' }))); }
    const title = el('div', { class: 'item-title' + (m.title ? '' : ' untitled') });
    title.innerHTML = m.title ? highlight(m.title) : 'Untitled';
    const ex = el('div', { class: 'item-ex' }); ex.innerHTML = excerpt(m);
    const meta = el('div', { class: 'item-meta' });
    if (m.time) meta.append(el('span', {}, m.time));
    if (m.images) { const s = el('span'); s.innerHTML = ICON.photo + ' ' + m.images; meta.append(s); }
    if (m.tags.length) meta.append(el('span', {}, m.tags.slice(0, 3).map(t => '#' + t).join(' ')));
    list.append(el('button', {
      class: 'item' + (state.current && state.current.id === m.id ? ' active' : ''),
      'data-id': m.id, onclick: () => openEntry(m.id),
    },
      el('div', { class: 'item-date' }, el('b', {}, String(dateOf(m.date).getDate())), el('span', {}, fmt(m.date, { weekday: 'short' }))),
      el('div', { class: 'item-main' }, title, m.text.trim() ? ex : null, meta.childNodes.length ? meta : null)));
  }
}

function renderTags() {
  const counts = new Map();
  for (const m of state.metas) for (const t of m.tags) counts.set(t, (counts.get(t) || 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  $('#tagbar').replaceChildren(...top.map(([t, n]) => el('button', {
    class: state.tag === t ? 'on' : '', title: plainEntries(n),
    onclick: () => { state.tag = state.tag === t ? null : t; renderSidebar(); },
  }, '#' + t)));
  $('#tagList').replaceChildren(...[...counts.keys()].sort().map(t => el('option', { value: t })));
}

function renderFilterNote() {
  const note = $('#filterNote');
  const parts = [];
  if (state.selectedDay) parts.push(fmt(state.selectedDay, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (state.tag) parts.push('#' + state.tag);
  if (state.query) parts.push(`“${state.query}”`);
  if (!parts.length) { note.hidden = true; return; }
  const n = state.metas.filter(matches).length;
  note.hidden = false;
  note.replaceChildren(el('span', {}, `${plainEntries(n)} for ${parts.join(', ')}`),
    el('button', { onclick: () => { state.selectedDay = null; state.tag = null; state.query = ''; $('#search').value = ''; renderSidebar(); } }, 'Show all'));
}

function streak() {
  const days = new Set(state.metas.map(m => m.date));
  const d = new Date();
  if (!days.has(isoOf(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(isoOf(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function renderStats() {
  const s = streak();
  $('#stats').textContent = plainEntries(state.metas.length) + (s > 1 ? `, ${s}-day streak` : '');
}

function renderOnThisDay() {
  const md = todayISO().slice(5), y = todayISO().slice(0, 4);
  const past = state.metas.filter(m => m.date.slice(5) === md && m.date.slice(0, 4) < y);
  const btn = $('#onThisDay');
  if (!past.length) { btn.hidden = true; return; }
  const years = [...new Set(past.map(m => m.date.slice(0, 4)))].sort().reverse();
  btn.hidden = false;
  btn.innerHTML = `<strong>On this day</strong> you wrote ${esc(plainEntries(past.length))} in ${esc(years.join(', '))}`;
  btn.onclick = () => {
    if (past.length === 1) return openEntry(past[0].id);
    state.selectedDay = null; state.tag = null; state.query = ''; $('#search').value = '';
    renderSidebar();
    openEntry(sorted(past)[0].id);
  };
}

/* ---------- calendar ---------- */
function firstDayOfWeek() {
  try {
    const loc = new Intl.Locale(navigator.language);
    const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo;
    if (info && info.firstDay) return info.firstDay % 7; // 7 = Sunday -> 0
  } catch {}
  return 1;
}

function renderCalendar() {
  const vm = state.viewMonth, grid = $('#calGrid');
  $('#calTitle').textContent = vm.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const fdw = firstDayOfWeek();
  const days = new Set(state.metas.map(m => m.date));
  grid.replaceChildren();
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 7 + ((fdw + i) % 7)); // 7 Jan 2024 is a Sunday
    grid.append(el('div', { class: 'cal-dow', 'aria-hidden': 'true' }, d.toLocaleDateString(undefined, { weekday: 'narrow' })));
  }
  const start = new Date(vm);
  start.setDate(1 - ((vm.getDay() - fdw + 7) % 7));
  const today = todayISO();
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    if (i >= 35 && d.getMonth() !== vm.getMonth()) break;
    const iso = isoOf(d);
    const cls = ['cal-day'];
    if (d.getMonth() !== vm.getMonth()) cls.push('out');
    if (days.has(iso)) cls.push('has');
    if (iso === today) cls.push('today');
    if (iso === state.selectedDay) cls.push('sel');
    const n = state.metas.filter(m => m.date === iso).length;
    grid.append(el('button', {
      class: cls.join(' '), 'aria-label': d.toLocaleDateString(undefined, { dateStyle: 'full' }) + (n ? `, ${plainEntries(n)}` : ''),
      title: n ? plainEntries(n) : '',
      onclick: () => pickDay(iso),
    }, String(d.getDate())));
  }
}

async function pickDay(iso) {
  if (state.selectedDay === iso) { state.selectedDay = null; renderSidebar(); return; }
  state.selectedDay = iso;
  const d = dateOf(iso); state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  renderSidebar();
  const onDay = sorted(state.metas.filter(m => m.date === iso));
  if (onDay.length) await openEntry(onDay[0].id);
}

$('#calPrev').onclick = () => { state.viewMonth.setMonth(state.viewMonth.getMonth() - 1); renderCalendar(); };
$('#calNext').onclick = () => { state.viewMonth.setMonth(state.viewMonth.getMonth() + 1); renderCalendar(); };
$('#calTitle').onclick = () => { const d = new Date(); state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); };

function renderSidebar() { renderCalendar(); renderOnThisDay(); renderTags(); renderFilterNote(); renderList(); renderStats(); }

let searchTimer;
$('#search').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = e.target.value.trim(); renderFilterNote(); renderList(); }, 120);
});
$('#search').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; state.query = ''; renderFilterNote(); renderList(); }
  if (e.key === 'Enter') { const first = $('#list .item'); if (first) first.click(); }
});

/* ---------- editor ---------- */
const body = $('#body'), titleIn = $('#title');

function showEmpty() {
  state.current = null;
  $('#sheet').hidden = true; $('#pageFoot').hidden = true;
  $('#toolbar').setAttribute('aria-disabled', 'true');
  const box = $('#empty'); box.hidden = false;
  const first = state.metas.length === 0;
  box.replaceChildren(
    el('h2', {}, first ? 'Your first page is blank.' : fmt(todayISO(), { weekday: 'long', day: 'numeric', month: 'long' })),
    el('p', {}, first
      ? 'Write about today, or anything at all. Entries are encrypted with your password and stay on this computer.'
      : 'Nothing written yet today. A few lines is enough.'),
    el('button', { class: 'btn-ink', onclick: () => newEntry(todayISO()) }, 'Write today’s entry'));
}

function showSheet() {
  $('#empty').hidden = true; $('#sheet').hidden = false; $('#pageFoot').hidden = false;
  $('#toolbar').removeAttribute('aria-disabled');
}

function renderStamp() {
  const c = state.current; if (!c) return;
  const d = dateOf(c.date);
  $('#stampDay').textContent = d.getDate();
  $('#stampWeekday').textContent = d.toLocaleDateString(undefined, { weekday: 'long' });
  $('#stampMonth').textContent = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  $('#stampTime').textContent = c.time || 'Add a time';
}

function renderChips() {
  const c = state.current;
  $('#tagChips').replaceChildren(...c.tags.map(t => el('span', { class: 'chip' }, t,
    el('button', { type: 'button', 'aria-label': `Remove tag ${t}`, onclick: () => { c.tags = c.tags.filter(x => x !== t); renderChips(); markDirty(); } }, '×'))));
}

async function openEntry(id) {
  if (state.current && state.current.id === id) { showSheet(); return; }
  await saveNow();
  let e;
  try { e = await api.get(id); } catch (x) { toast('This entry could not be opened: ' + x.message); return; }
  state.current = { id: e.id, date: e.date, time: e.time, title: e.title, tags: [...e.tags], saved: true };
  titleIn.value = e.title;
  body.innerHTML = clean(e.html);
  renderStamp(); renderChips(); showSheet(); updateCounts();
  $('#saveState').textContent = 'Saved';
  $('#sheetScroll').scrollTop = 0;
  const d = dateOf(e.date);
  if (d.getMonth() !== state.viewMonth.getMonth() || d.getFullYear() !== state.viewMonth.getFullYear()) {
    state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar();
  }
  document.querySelectorAll('#list .item').forEach(n => n.classList.toggle('active', n.dataset.id === id));
}

async function newEntry(date = todayISO()) {
  await saveNow();
  state.current = { id: crypto.randomUUID(), date, time: date === todayISO() ? nowTime() : '', title: '', tags: [], saved: false };
  titleIn.value = ''; body.innerHTML = '';
  renderStamp(); renderChips(); showSheet(); updateCounts();
  $('#saveState').textContent = 'Not saved yet';
  document.querySelectorAll('#list .item.active').forEach(n => n.classList.remove('active'));
  body.focus();
}

function isBlank() {
  return !titleIn.value.trim() && !body.innerText.trim() && !body.querySelector('img') && !state.current.tags.length;
}

let saveTimer, saving = Promise.resolve();
function markDirty() {
  if (!state.current) return;
  state.dirty = true;
  $('#saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
}

function saveNow() {
  clearTimeout(saveTimer);
  const c = state.current;
  if (!c || !state.dirty || !state.unlocked) return saving;
  if (!c.saved && isBlank()) { state.dirty = false; return saving; }
  state.dirty = false;
  const snap = {
    id: c.id, date: c.date, time: c.time, title: titleIn.value.trim(), tags: c.tags,
    html: clean(body.innerHTML), text: body.innerText,
  };
  saving = saving.then(() => api.save(snap)).then(meta => {
    c.saved = true;
    const i = state.metas.findIndex(m => m.id === meta.id);
    if (i >= 0) state.metas[i] = meta; else state.metas.push(meta);
    if (state.current === c && !state.dirty) $('#saveState').textContent = 'Saved';
    renderSidebar();
  }).catch(err => {
    state.dirty = true;
    $('#saveState').textContent = 'Not saved: ' + err.message;
  });
  return saving;
}

function updateCounts() {
  const words = (body.innerText.match(/\S+/g) || []).length;
  const mins = Math.max(1, Math.round(words / 220));
  $('#wordCount').textContent = words ? `${plural(words, 'word')}, about ${mins} min to read` : '';
}

body.addEventListener('input', () => { markDirty(); updateCounts(); });
titleIn.addEventListener('input', markDirty);
titleIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#tagInput').focus(); } });
body.addEventListener('focus', () => document.execCommand('defaultParagraphSeparator', false, 'p'));

// Tags
const tagInput = $('#tagInput');
function addTagsFrom(value) {
  const c = state.current; if (!c) return;
  const add = value.split(/[,#]/).map(t => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean);
  let changed = false;
  for (const t of add) if (!c.tags.includes(t)) { c.tags.push(t); changed = true; }
  tagInput.value = '';
  if (changed) { renderChips(); markDirty(); }
}
tagInput.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ',') && tagInput.value.trim()) { e.preventDefault(); addTagsFrom(tagInput.value); }
  else if (e.key === 'Enter') { e.preventDefault(); body.focus(); }
  else if (e.key === 'Backspace' && !tagInput.value && state.current.tags.length) { state.current.tags.pop(); renderChips(); markDirty(); }
});
tagInput.addEventListener('change', () => { if (tagInput.value.trim()) addTagsFrom(tagInput.value); });
tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) addTagsFrom(tagInput.value); });

// Date & time
const dateInput = $('#dateInput'), timeInput = $('#timeInput');
const pickDate = () => { dateInput.value = state.current.date; dateInput.showPicker(); };
$('#stampDay').onclick = pickDate; $('#stampWeekday').onclick = pickDate;
dateInput.addEventListener('change', () => {
  if (!dateInput.value) return;
  state.current.date = dateInput.value; renderStamp(); markDirty();
});
$('#stampTime').onclick = () => { timeInput.value = state.current.time || nowTime(); timeInput.showPicker(); };
timeInput.addEventListener('change', () => { state.current.time = timeInput.value; renderStamp(); markDirty(); });

// Delete
$('#deleteBtn').onclick = async () => {
  const c = state.current; if (!c) return;
  const ok = await confirmDialog({ title: 'Delete this entry?', text: 'It will be removed from your journal for good. Backups you have already saved keep their copy.', ok: 'Delete entry', danger: true });
  if (!ok) return;
  clearTimeout(saveTimer); state.dirty = false;
  await saving;
  if (c.saved) { try { await api.remove(c.id); } catch (x) { toast(x.message); return; } }
  state.metas = state.metas.filter(m => m.id !== c.id);
  showEmpty(); renderSidebar(); toast('Entry deleted');
};

/* ---------- formatting toolbar ---------- */
const exec = (cmd, val = null) => { body.focus(); document.execCommand(cmd, false, val); markDirty(); refreshToolbar(); };
const blockIs = tag => (document.queryCommandValue('formatBlock') || '').toLowerCase() === tag;

const TOOLS = [
  { k: 'bold', title: 'Bold (Ctrl+B)', run: () => exec('bold'), on: () => document.queryCommandState('bold') },
  { k: 'italic', title: 'Italic (Ctrl+I)', run: () => exec('italic'), on: () => document.queryCommandState('italic') },
  { k: 'underline', title: 'Underline (Ctrl+U)', run: () => exec('underline'), on: () => document.queryCommandState('underline') },
  { k: 'strike', title: 'Strikethrough', run: () => exec('strikeThrough'), on: () => document.queryCommandState('strikeThrough') },
  '|',
  { k: 'h2', title: 'Heading', run: () => exec('formatBlock', blockIs('h2') ? 'p' : 'h2'), on: () => blockIs('h2') },
  { k: 'quote', title: 'Quote', run: () => exec('formatBlock', blockIs('blockquote') ? 'p' : 'blockquote'), on: () => blockIs('blockquote') },
  { k: 'ul', title: 'Bulleted list', run: () => exec('insertUnorderedList'), on: () => document.queryCommandState('insertUnorderedList') },
  { k: 'ol', title: 'Numbered list', run: () => exec('insertOrderedList'), on: () => document.queryCommandState('insertOrderedList') },
  '|',
  { k: 'mark', title: 'Highlight', run: toggleMark, on: () => !!closest('MARK') },
  { k: 'link', title: 'Link (Ctrl+K)', run: insertLink, on: () => !!closest('A') },
  { k: 'image', title: 'Add photos', run: () => $('#imgFile').click() },
  { k: 'hr', title: 'Section break', run: () => exec('insertHorizontalRule') },
  '|',
  { k: 'clear', title: 'Clear formatting', run: () => { exec('removeFormat'); exec('formatBlock', 'p'); } },
];

const toolbar = $('#toolbar');
for (const t of TOOLS) {
  if (t === '|') { toolbar.append(el('span', { class: 'sep' })); continue; }
  const b = el('button', { class: 'icon-btn', title: t.title, 'aria-label': t.title, 'data-k': t.k });
  b.innerHTML = ICON[t.k];
  b.addEventListener('mousedown', e => e.preventDefault()); // keep the selection
  b.addEventListener('click', () => t.run());
  toolbar.append(b);
}

function refreshToolbar() {
  if (!body.contains(document.getSelection().anchorNode)) return;
  for (const t of TOOLS) if (t.on) toolbar.querySelector(`[data-k="${t.k}"]`).classList.toggle('on', !!t.on());
}
document.addEventListener('selectionchange', refreshToolbar);

function closest(tag) {
  let n = document.getSelection().anchorNode;
  while (n && n !== body) { if (n.nodeName === tag) return n; n = n.parentNode; }
  return null;
}

function toggleMark() {
  const m = closest('MARK');
  if (m) { m.replaceWith(...m.childNodes); markDirty(); return; }
  const sel = document.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) { toast('Select some words to highlight'); return; }
  const frag = sel.getRangeAt(0).cloneContents();
  const div = document.createElement('div'); div.append(frag);
  exec('insertHTML', `<mark>${clean(div.innerHTML)}</mark>`);
}

async function insertLink() {
  const existing = closest('A');
  const sel = document.getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const url = await promptDialog({ title: existing ? 'Edit link' : 'Add a link', label: 'Web address', type: 'url', value: existing ? existing.getAttribute('href') || '' : 'https://', ok: existing ? 'Save link' : 'Add link' });
  body.focus();
  if (range) { sel.removeAllRanges(); sel.addRange(range); }
  if (url == null) return;
  const href = url.trim();
  if (!href || href === 'https://') { if (existing) existing.replaceWith(...existing.childNodes); markDirty(); return; }
  if (!/^(https?:|mailto:)/i.test(href)) { toast('Links need to start with http:// or https://'); return; }
  if (existing) { existing.setAttribute('href', href); markDirty(); return; }
  if (sel.isCollapsed) exec('insertHTML', `<a href="${esc(href)}">${esc(href)}</a>`);
  else exec('createLink', href);
}

body.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (a && (e.ctrlKey || e.metaKey) && a.href) { e.preventDefault(); api.openExternal(a.href); }
  if (e.target.tagName === 'IMG') {
    const r = document.createRange(); r.selectNode(e.target);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
});
body.addEventListener('mouseover', e => { const a = e.target.closest('a'); if (a) a.title = 'Ctrl+click to open ' + a.getAttribute('href'); });
body.addEventListener('dblclick', e => {
  if (e.target.tagName !== 'IMG') return;
  const lb = $('#lightbox'); lb.querySelector('img').src = e.target.src; lb.hidden = false;
});
$('#lightbox').onclick = () => { $('#lightbox').hidden = true; $('#lightbox img').removeAttribute('src'); };

/* ---------- photos ---------- */
async function imageToDataUrl(file) {
  const readAsUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
  if (file.type === 'image/gif' && file.size < 6e6) return readAsUrl(file); // keep animation
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const MAX = 1800;
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 450e3 && /png|jpe?g|webp/.test(file.type)) { bmp.close(); return readAsUrl(file); }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.86);
}

async function insertImages(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  if (!state.current) await newEntry(todayISO());
  body.focus();
  for (const f of imgs) {
    try { exec('insertHTML', `<img src="${await imageToDataUrl(f)}" alt=""><p><br></p>`); }
    catch { toast(`Could not read ${f.name}`); }
  }
  updateCounts();
}

$('#imgFile').addEventListener('change', e => { insertImages(e.target.files); e.target.value = ''; });

body.addEventListener('paste', e => {
  const cd = e.clipboardData;
  const files = [...cd.files].filter(f => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); insertImages(files); return; }
  const html = cd.getData('text/html');
  if (html) { e.preventDefault(); exec('insertHTML', cleanPaste(html)); }
});
body.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); body.classList.add('dragover'); } });
body.addEventListener('dragleave', () => body.classList.remove('dragover'));
body.addEventListener('drop', e => {
  body.classList.remove('dragover');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (pos) { const s = document.getSelection(); s.removeAllRanges(); s.addRange(pos); }
  insertImages(e.dataTransfer.files);
});
// Don't let a file dropped outside the editor navigate the window.
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

/* ---------- settings ---------- */
function applySettings() {
  const s = state.settings;
  document.documentElement.style.setProperty('--write-size', s.fontSize + 'px');
  body.spellcheck = !!s.spellcheck;
}

async function updateSetting(patch) {
  state.settings = await api.setSettings({ ...state.settings, ...patch });
  applySettings();
}

function openSettings() {
  return openDialog((f, done) => {
    const s = state.settings;
    const totalWords = state.metas.reduce((a, m) => a + m.words, 0);
    const photos = state.metas.reduce((a, m) => a + m.images, 0);
    const since = state.metas.length ? sorted(state.metas).at(-1).date : null;

    const select = (val, opts, on) => {
      const sel = el('select', { onchange: e => on(e.target.value) }, ...opts.map(([v, l]) => el('option', { value: v }, l)));
      sel.value = String(val); return sel;
    };
    const check = (val, on) => { const c = el('input', { type: 'checkbox', onchange: e => on(e.target.checked) }); c.checked = val; return c; };
    const size = el('input', { type: 'range', min: 15, max: 26, step: 1, value: s.fontSize, oninput: e => updateSetting({ fontSize: +e.target.value }) });
    const row = (label, help, control) => el('div', { class: 'row' }, el('div', {}, label, help ? el('small', {}, help) : null), control);

    f.append(
      el('h2', {}, 'Settings'),
      el('div', { class: 'stat-line' },
        el('div', {}, el('b', {}, state.metas.length.toLocaleString()), 'entries'),
        el('div', {}, el('b', {}, totalWords.toLocaleString()), 'words'),
        el('div', {}, el('b', {}, photos.toLocaleString()), 'photos'),
        el('div', {}, el('b', {}, String(streak())), 'day streak')),
      since ? el('p', { style: 'margin-top:6px' }, `Writing since ${fmt(since, { day: 'numeric', month: 'long', year: 'numeric' })}.`) : null,

      el('h3', {}, 'Writing'),
      row('Theme', null, select(s.theme, [['system', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']], v => updateSetting({ theme: v }))),
      row('Text size', null, size),
      row('Check spelling', 'Underlines misspelled words. Right-click for suggestions.', check(s.spellcheck, v => updateSetting({ spellcheck: v }))),

      el('h3', {}, 'Privacy'),
      row('Lock after inactivity', null, select(s.autoLockMinutes, [['1', '1 minute'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['0', 'Never']], v => updateSetting({ autoLockMinutes: +v }))),
      row('Lock when minimised', 'Also locks when Windows locks or the computer sleeps.', check(s.lockOnMinimize, v => updateSetting({ lockOnMinimize: v }))),
      row('Password', null, el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); changePassword(); } }, 'Change password')),

      el('h3', {}, 'Backups'),
      el('p', {}, 'Backups are encrypted with your current password. Keep one on a USB drive or cloud folder in case this computer fails.'),
      el('div', { class: 'btns' },
        el('button', { type: 'button', class: 'btn-ink', onclick: doBackup }, 'Save a backup'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); doImport(); } }, 'Import a backup'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); doExportReadable(); } }, 'Export readable copy')),
      el('p', { class: 'path', style: 'margin-top:14px' }, 'Journal folder: ', state.dataDir, ' ',
        el('button', { type: 'button', class: 'btn-link', onclick: () => api.showDataFolder() }, 'Show folder')),

      el('h3', {}, 'About'),
      el('div', { class: 'row' }, el('div', {}, 'Daybook ' + state.version, el('small', { id: 'updStatus' }, 'Updates install automatically when you restart.')),
        el('button', { type: 'button', class: 'btn-plain', onclick: checkUpdates }, 'Check for updates')),

      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-ink', onclick: () => done() }, 'Done')),
    );
  });
}

async function checkUpdates() {
  const out = $('#updStatus'); out.textContent = 'Checking…';
  const r = await api.checkUpdates().catch(() => ({ status: 'offline' }));
  out.textContent = {
    dev: 'Updates are only checked in the installed app.',
    ready: `Version ${r.version} is ready. Restart Daybook to install it.`,
    downloading: `Downloading version ${r.version}. You'll be asked to restart when it's ready.`,
    latest: 'You have the latest version.',
    offline: "Couldn't reach the update server. Check your connection and try again.",
  }[r.status];
}

function showUpdate(version) {
  $('#updateText').textContent = `Daybook ${version} is ready to install.`;
  $('#updateBar').hidden = false;
}
$('#updateBtn').onclick = async () => {
  $('#updateBtn').disabled = true; $('#updateBtn').textContent = 'Restarting…';
  await saveNow();
  api.installUpdate();
};

async function doBackup() {
  await saveNow();
  try { const r = await api.exportBackup(); if (r) toast(`Backup saved with ${plainEntries(r.count)}`); }
  catch (x) { toast('Backup failed: ' + x.message); }
}

async function doImport() {
  await saveNow();
  const file = await api.pickBackup(); if (!file) return;
  const pw = await promptDialog({ title: 'Import a backup', text: 'Entries from the backup are added to this journal. Where both have the same entry, the newer version is kept.', label: 'Password used for that backup', type: 'password', ok: 'Import' });
  if (!pw) return;
  try {
    const r = await api.importBackup(file, pw);
    state.metas = await api.list(); renderSidebar();
    toast(r.added || r.updated ? `Imported: ${r.added} new, ${r.updated} updated` : 'Nothing new in that backup');
  } catch (x) { toast(x.message); }
}

async function doExportReadable() {
  const ok = await confirmDialog({ title: 'Export a readable copy?', text: 'This saves every entry, with photos, as one web page you can open or print. That file is not encrypted, so anyone who finds it can read it.', ok: 'Choose where to save' });
  if (!ok) return;
  await saveNow();
  try { const r = await api.exportReadable(); if (r) toast(`Exported ${plainEntries(r.count)}`); }
  catch (x) { toast('Export failed: ' + x.message); }
}

function changePassword() {
  return openDialog((f, done) => {
    const cur = el('input', { type: 'password', autofocus: true, autocomplete: 'current-password' });
    const a = el('input', { type: 'password', autocomplete: 'new-password' });
    const b = el('input', { type: 'password', autocomplete: 'new-password' });
    const err = el('p', { class: 'err', role: 'alert' });
    const btn = el('button', { type: 'submit', class: 'btn-ink' }, 'Change password');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (a.value.length < 6) { err.textContent = 'Use at least 6 characters.'; return; }
      if (a.value !== b.value) { err.textContent = 'The new passwords do not match.'; return; }
      btn.disabled = true; btn.textContent = 'Changing…';
      try { await api.changePassword(cur.value, a.value); done(); toast('Password changed'); }
      catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Change password'; }
    });
    f.append(el('h2', {}, 'Change password'),
      el('p', {}, 'Older backups still open with the password they were made with.'),
      el('label', { class: 'field' }, 'Current password', cur),
      el('label', { class: 'field' }, 'New password', a),
      el('label', { class: 'field' }, 'Type the new password again', b), err,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-plain', onclick: () => done() }, 'Cancel'), btn));
  });
}

/* ---------- global wiring ---------- */
$('#newBtn').onclick = () => newEntry(state.selectedDay || todayISO());
$('#lockBtn').onclick = lockNow;
$('#settingsBtn').onclick = openSettings;

document.addEventListener('keydown', e => {
  if (!state.unlocked) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    if (k === 'n') { e.preventDefault(); newEntry(state.selectedDay || todayISO()); }
    else if (k === 'l') { e.preventDefault(); lockNow(); }
    else if (k === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); }
    else if (k === 's') { e.preventDefault(); state.dirty = true; saveNow().then(() => toast('Saved')); }
    else if (k === 'k' && body.contains(document.activeElement)) { e.preventDefault(); insertLink(); }
    else if (k === ',') { e.preventDefault(); openSettings(); }
  }
  if (e.key === 'Escape' && !$('#lightbox').hidden) $('#lightbox').click();
}, true);

for (const ev of ['mousemove', 'keydown', 'mousedown', 'wheel']) {
  window.addEventListener(ev, () => { state.lastActivity = Date.now(); }, { passive: true, capture: true });
}
setInterval(() => {
  const m = state.settings.autoLockMinutes;
  if (state.unlocked && m > 0 && Date.now() - state.lastActivity > m * 60000) lockNow();
}, 10000);

// Keep "today" correct if the app stays open past midnight.
let lastDay = todayISO();
setInterval(() => { if (state.unlocked && todayISO() !== lastDay) { lastDay = todayISO(); renderSidebar(); } }, 60000);

api.onFlush(() => saveNow());
api.onUpdateReady(showUpdate);
api.version().then(v => { state.version = v.version; if (v.updateReady) showUpdate(v.updateReady); }).catch(() => {});
api.onLock(() => lockNow());
window.addEventListener('blur', () => saveNow());

boot();
