'use strict';
/* WellWrite — renderer */
const api = window.wellwrite;
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
/** The default title for an entry: its date, e.g. "Friday 30 October 2026". */
const dateTitle = iso => fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
  xref: '<svg viewBox="0 0 20 20"><path d="M3.5 3.5h6v8h-6zM10.5 8.5h6v8h-6z"/><path d="M9.5 6h2.5a2 2 0 0 1 2 2v.5M10.5 14H8a2 2 0 0 1-2-2v-.5"/></svg>',
  back: '<svg viewBox="0 0 20 20"><path d="M11 5l-5 5 5 5"/></svg>',
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
  category: null,       // category filter (id, or '' for "no category")
  categories: [],       // [{ id, name, color }]
  trail: [],            // entries visited by following links, for "Back"
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
  // Web links, email, and links to other entries. (Photos are data: images, which DOMPurify allows on <img>.)
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|wellwrite:entry\/)/i,
};
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'IMG' && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(node.getAttribute('src') || '')) node.remove();
  if (node.tagName === 'A' && !/^(https?:|mailto:|wellwrite:entry\/[a-z0-9-]{8,64}$)/i.test(node.getAttribute('href') || '')) node.removeAttribute('href');
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
    addReveal(form);
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


/* ---------- show / hide password ---------- */
const EYE = '<svg viewBox="0 0 20 20"><path d="M1.8 10S4.8 4.2 10 4.2 18.2 10 18.2 10 15.2 15.8 10 15.8 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 20 20"><path d="M3 3l14 14M8.2 4.4A8.6 8.6 0 0 1 10 4.2c5.2 0 8.2 5.8 8.2 5.8a14 14 0 0 1-2.6 3.3M5.6 5.7A14.3 14.3 0 0 0 1.8 10s3 5.8 8.2 5.8a8 8 0 0 0 3.8-1"/><path d="M8.1 8.2a2.6 2.6 0 0 0 3.7 3.6"/></svg>';
function setReveal(input, show) {
  input.type = show ? 'text' : 'password';
  const b = input.parentNode.querySelector('.pw-eye');
  if (!b) return;
  b.innerHTML = show ? EYE_OFF : EYE;
  b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  b.title = show ? 'Hide password' : 'Show password';
  b.setAttribute('aria-pressed', String(show));
}
/** Give every password box in `root` a show/hide button. */
function addReveal(root = document) {
  for (const input of root.querySelectorAll('input[type=password]:not([data-reveal])')) {
    input.dataset.reveal = '1';
    input.spellcheck = false;
    const wrap = el('span', { class: 'pw-wrap' });
    input.replaceWith(wrap);
    const btn = el('button', { type: 'button', class: 'pw-eye' });
    btn.addEventListener('mousedown', e => e.preventDefault()); // keep the cursor in the box
    btn.addEventListener('click', () => { setReveal(input, input.type === 'password'); input.focus(); });
    wrap.append(input, btn);
    setReveal(input, false);
  }
}
/** Hide every password again (on lock, and when a dialog closes). */
function hideAllPasswords(root = document) {
  for (const input of root.querySelectorAll('input[data-reveal]')) setReveal(input, false);
}

/* ---------- lock screen ---------- */
async function boot() {
  addReveal($('#lock'));
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
  hideAllPasswords($('#lock'));
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
  let info = null;
  try { info = await api.backupInfo(); } catch {}
  if (info && info.google.available) {
    const pick = await openDialog((f, done) => f.append(
      el('h2', {}, 'Restore from a backup'),
      el('p', {}, 'Where is your backup?'),
      el('div', { class: 'actions', style: 'justify-content:flex-start' },
        el('button', { type: 'button', class: 'btn-ink', autofocus: true, onclick: () => done('google') }, 'Google Drive'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => done('file') }, 'A backup file'),
        el('button', { type: 'button', class: 'btn-link', style: 'margin-left:auto', onclick: () => done(null) }, 'Cancel'))));
    if (pick === 'google') { restoreFromDrive('fresh'); return; }
    if (pick !== 'file') return;
  }
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
  try { state.categories = await api.getCategories(); } catch { state.categories = []; }
  state.selectedDay = null; state.query = ''; state.tag = null; state.category = null; state.trail = []; $('#search').value = '';
  const d = new Date(); state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  $('#lock').hidden = true;
  $('#app').hidden = false;
  const today = sorted(state.metas.filter(m => m.date === todayISO()))[0];
  if (today) await openEntry(today.id); else showEmpty();
  renderSidebar();
  refreshBackupInfo();
}

async function lockNow() {
  if (!state.unlocked) return;
  await saveNow();
  state.unlocked = false;
  try { await api.lock(); } catch {}
  // Wipe everything readable from the page.
  state.metas = []; state.current = null; state.categories = []; state.trail = [];
  closePopover();
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
  if (state.category != null && (catById(m.category) ? m.category : '') !== state.category) return false;
  if (state.query) {
    const cat = catById(m.category);
    const hay = (m.title + ' ' + m.tags.map(t => '#' + t).join(' ') + ' ' + (cat ? cat.name : '') + ' ' + m.text).toLowerCase();
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
      const when = fmt(state.selectedDay, { day: 'numeric', month: 'long' });
      const drafting = state.current && !state.current.saved && state.current.date === state.selectedDay;
      if (drafting) box.append(`Nothing written on ${when} yet. The page on the right is ready for you.`);
      else {
        box.append(`Nothing written on ${when}. `);
        box.append(el('button', { class: 'btn-link', style: 'color:var(--foil)', onclick: () => newEntry(state.selectedDay).then(renderList) }, 'Write an entry for this day'));
      }
    } else if (state.query || state.tag || state.category != null) box.textContent = 'No entries match. Try fewer words, or clear the filter.';
    else box.textContent = 'Your entries will appear here.';
    list.append(box);
    return;
  }

  let month = '';
  for (const m of items) {
    const mk = m.date.slice(0, 7);
    if (mk !== month) { month = mk; list.append(el('div', { class: 'list-month' }, fmt(m.date, { month: 'long', year: 'numeric' }))); }
    const title = el('div', { class: 'item-title' });
    title.innerHTML = highlight(m.title || dateTitle(m.date));
    const cat = catById(m.category);
    if (cat) title.prepend(el('span', { class: 'dot', style: `background:${cat.color}`, title: cat.name }));
    const ex = el('div', { class: 'item-ex' }); ex.innerHTML = excerpt(m);
    const meta = el('div', { class: 'item-meta' });
    if (m.time) meta.append(el('span', {}, m.time));
    if (m.images) { const s = el('span'); s.innerHTML = ICON.photo + ' ' + m.images; meta.append(s); }
    if (m.tags.length) meta.append(el('span', {}, m.tags.slice(0, 3).map(t => '#' + t).join(' ')));
    const links = (m.links || []).length + state.metas.filter(x => x.links && x.links.includes(m.id)).length;
    if (links) { const s = el('span', { title: 'Connected entries' }); s.innerHTML = ICON.xref + ' ' + links; meta.append(s); }
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
  if (state.category != null) parts.push(state.category ? (catById(state.category) || {}).name : 'no category');
  if (state.tag) parts.push('#' + state.tag);
  if (state.query) parts.push(`“${state.query}”`);
  if (!parts.length) { note.hidden = true; return; }
  const n = state.metas.filter(matches).length;
  note.hidden = false;
  note.replaceChildren(el('span', {}, `${plainEntries(n)} for ${parts.join(', ')}`),
    el('button', { onclick: () => { state.selectedDay = null; state.tag = null; state.category = null; state.query = ''; $('#search').value = ''; renderSidebar(); } }, 'Show all'));
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
  // Nothing written that day: open a blank page for it. It's only saved once you type.
  else if (!(state.current && !state.current.saved && state.current.date === iso)) await newEntry(iso);
  renderList();
}

$('#calPrev').onclick = () => { state.viewMonth.setMonth(state.viewMonth.getMonth() - 1); renderCalendar(); };
$('#calNext').onclick = () => { state.viewMonth.setMonth(state.viewMonth.getMonth() + 1); renderCalendar(); };
$('#calTitle').onclick = () => { const d = new Date(); state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar(); };

function renderSidebar() { renderCalendar(); renderOnThisDay(); renderCategoryBar(); renderTags(); renderFilterNote(); renderList(); renderStats(); renderBackupCard(); }

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
  $('#tagChips').replaceChildren(...c.tags.map(t => el('span', { class: 'chip' },
    el('button', { type: 'button', class: 'chip-name', title: `Show every entry tagged #${t}`, onclick: () => { state.tag = t; state.selectedDay = null; renderSidebar(); } }, t),
    el('button', { type: 'button', 'aria-label': `Remove tag ${t}`, onclick: () => { c.tags = c.tags.filter(x => x !== t); renderChips(); markDirty(); } }, '×'))));
}

async function openEntry(id, { via } = {}) {
  if (state.current && state.current.id === id) { showSheet(); return; }
  const from = state.current && state.current.saved ? state.current.id : null;
  await saveNow();
  let e;
  try { e = await api.get(id); } catch (x) { toast('This entry could not be opened: ' + x.message); return; }
  if (via === 'link' && from) state.trail.push(from);
  else if (via !== 'back') state.trail = [];
  state.current = { id: e.id, date: e.date, time: e.time, title: e.title, tags: [...e.tags], category: e.category || '', saved: true };
  titleIn.value = e.title || dateTitle(e.date);
  body.innerHTML = clean(e.html);
  decorateLinks();
  renderStamp(); renderChips(); renderCategoryPill(); showSheet(); updateCounts(); renderConnections(); renderBackLink();
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
  state.current = { id: crypto.randomUUID(), date, time: date === todayISO() ? nowTime() : '', title: '', tags: [], category: catById(state.category) ? state.category : '', saved: false };
  state.trail = [];
  titleIn.value = dateTitle(date); body.innerHTML = '';
  renderStamp(); renderChips(); renderCategoryPill(); showSheet(); updateCounts(); renderConnections(); renderBackLink();
  $('#saveState').textContent = 'Not saved yet';
  document.querySelectorAll('#list .item.active').forEach(n => n.classList.remove('active'));
  body.focus();
}

function isBlank() {
  const t = titleIn.value.trim();
  return (!t || t === dateTitle(state.current.date)) && !body.innerText.trim() && !body.querySelector('img') && !state.current.tags.length;
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
    id: c.id, date: c.date, time: c.time, title: titleIn.value.trim(), tags: c.tags, category: c.category,
    html: clean(body.innerHTML), text: body.innerText,
  };
  saving = saving.then(() => api.save(snap)).then(meta => {
    c.saved = true;
    const i = state.metas.findIndex(m => m.id === meta.id);
    if (i >= 0) state.metas[i] = meta; else state.metas.push(meta);
    if (state.current === c && !state.dirty) $('#saveState').textContent = 'Saved';
    renderSidebar();
    if (state.current === c) renderConnections();
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
// While the title is still just the date, clicking into it puts the cursor at the end, ready to add to it.
titleIn.addEventListener('focus', () => {
  if (state.current && titleIn.value.trim() === dateTitle(state.current.date)) {
    setTimeout(() => { const n = titleIn.value.length; titleIn.setSelectionRange(n, n); });
  }
});
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
  // If the title is still just the date, keep it in step with the new date.
  const wasDefault = titleIn.value.trim() === dateTitle(state.current.date);
  state.current.date = dateInput.value;
  if (wasDefault) titleIn.value = dateTitle(state.current.date);
  renderStamp(); markDirty();
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


/* ---------- categories, entry links & connections ---------- */
const CAT_COLORS = ['#a23b56', '#2f7d7a', '#b7862c', '#4f6aa8', '#6b7d3a', '#7a4f8f', '#b0563a', '#6a7080'];
const catById = id => (id ? state.categories.find(c => c.id === id) : null) || null;
const metaById = id => state.metas.find(m => m.id === id);
const entryLabel = m => (m ? m.title || dateTitle(m.date) : 'Deleted entry');

// --- popover (category menu, link picker)
let popClose = null;
function showPopover(rect, build, onClose) {
  closePopover();
  const pop = $('#popover');
  pop.replaceChildren(); pop.hidden = false;
  build(pop);
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const x = Math.max(12, Math.min(rect.left, innerWidth - w - 12));
  let y = rect.bottom + 6;
  if (y + h > innerHeight - 12) y = Math.max(12, rect.top - h - 6);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  const outside = e => { if (!pop.contains(e.target)) closePopover(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  pop.addEventListener('keydown', esc);
  popClose = () => {
    document.removeEventListener('mousedown', outside, true);
    pop.removeEventListener('keydown', esc);
    pop.hidden = true; pop.replaceChildren();
    if (onClose) onClose();
  };
}
function closePopover() { if (popClose) { const f = popClose; popClose = null; f(); } }

// --- categories
async function saveCategories(list) {
  try { state.categories = await api.setCategories(list); }
  catch (x) { toast(x.message); }
  renderSidebar();
  if (state.current) renderCategoryPill();
}

function newCategory(name) {
  name = String(name || '').trim().slice(0, 40);
  if (!name) return null;
  const existing = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const used = state.categories.map(c => c.color);
  const color = CAT_COLORS.find(c => !used.includes(c)) || CAT_COLORS[state.categories.length % CAT_COLORS.length];
  return { id: 'c-' + crypto.randomUUID().slice(0, 8), name, color };
}

function renderCategoryPill() {
  const pill = $('#catPill'), c = state.current;
  if (!pill || !c) return;
  const cat = catById(c.category);
  pill.classList.toggle('is-empty', !cat);
  pill.replaceChildren(el('span', { class: 'dot', style: cat ? `background:${cat.color}` : '' }), cat ? cat.name : 'Add a category');
}

function setEntryCategory(id) {
  if (!state.current) return;
  state.current.category = id || '';
  renderCategoryPill(); markDirty();
}

$('#catPill').addEventListener('click', () => {
  const c = state.current; if (!c) return;
  showPopover($('#catPill').getBoundingClientRect(), pop => {
    pop.classList.add('menu');
    const opt = (cat, label) => el('button', {
      type: 'button', class: 'menu-item' + ((cat ? cat.id : '') === (catById(c.category) ? c.category : '') ? ' on' : ''),
      onclick: () => { setEntryCategory(cat ? cat.id : ''); closePopover(); },
    }, el('span', { class: 'dot', style: cat ? `background:${cat.color}` : '' }), label);
    pop.append(...state.categories.map(cat => opt(cat, cat.name)));
    if (state.categories.length) pop.append(opt(null, 'No category'), el('hr'));
    const input = el('input', { class: 'pop-search', placeholder: state.categories.length ? 'New category' : 'Name your first category', maxlength: '40' });
    const add = async name => {
      const cat = newCategory(name); if (!cat) return;
      if (!state.categories.some(x => x.id === cat.id)) await saveCategories([...state.categories, cat]);
      setEntryCategory(cat.id); closePopover();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); add(input.value); } });
    pop.append(input);
    if (!state.categories.length) {
      pop.append(el('div', { class: 'menu-suggest' }, 'Or pick one: ',
        ...['Personal', 'Work', 'Health', 'Family', 'Ideas'].map(n => el('button', { type: 'button', class: 'btn-link', onclick: () => add(n) }, n))));
    } else {
      pop.append(el('button', { type: 'button', class: 'menu-item subtle', onclick: () => { closePopover(); manageCategories(); } }, 'Edit categories…'));
    }
    setTimeout(() => input.focus());
  });
});

function renderCategoryBar() {
  const bar = $('#catbar');
  if (!state.categories.length) { bar.hidden = true; return; }
  bar.hidden = false;
  const count = id => state.metas.filter(m => (catById(m.category) ? m.category : '') === id).length;
  const chip = (id, name, color) => el('button', {
    class: 'cat-chip' + (state.category === id ? ' on' : ''), title: plainEntries(count(id)),
    onclick: () => { state.category = state.category === id ? null : id; renderSidebar(); },
  }, el('span', { class: 'dot', style: color ? `background:${color}` : '' }), name);
  bar.replaceChildren(...state.categories.map(c => chip(c.id, c.name, c.color)),
    el('button', { class: 'cat-edit', title: 'Edit categories', 'aria-label': 'Edit categories', onclick: manageCategories }, 'Edit'));
}

function manageCategories() {
  return openDialog((f, done) => {
    const list = el('div', { class: 'cat-list' });
    const count = id => state.metas.filter(m => m.category === id).length;
    const draw = () => {
      list.replaceChildren(...state.categories.map(cat => {
        const name = el('input', { type: 'text', value: cat.name, maxlength: '40', 'aria-label': 'Category name' });
        const commit = () => {
          const v = name.value.trim();
          if (v && v !== cat.name) saveCategories(state.categories.map(c => (c.id === cat.id ? { ...c, name: v } : c)));
          else name.value = cat.name;
        };
        name.addEventListener('change', commit);
        name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
        return el('div', { class: 'cat-row' },
          el('button', {
            type: 'button', class: 'swatch', style: `background:${cat.color}`, title: 'Change colour', 'aria-label': `Change colour of ${cat.name}`,
            onclick: async () => {
              const next = CAT_COLORS[(CAT_COLORS.indexOf(cat.color) + 1) % CAT_COLORS.length];
              await saveCategories(state.categories.map(c => (c.id === cat.id ? { ...c, color: next } : c))); draw();
            },
          }),
          name,
          el('small', {}, plainEntries(count(cat.id))),
          el('button', {
            type: 'button', class: 'btn-link danger', onclick: async e => {
              const n = count(cat.id), btn = e.currentTarget;
              if (n && !btn.dataset.armed) {
                // Ask once, in place: the entries are kept, they just lose this category.
                btn.dataset.armed = '1';
                btn.textContent = `Delete? ${plainEntries(n)} will have no category`;
                setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; } }, 4000);
                return;
              }
              if (n) await api.moveCategory(cat.id, '');
              state.metas = await api.list();
              if (state.current && state.current.category === cat.id) state.current.category = '';
              if (state.category === cat.id) state.category = null;
              await saveCategories(state.categories.filter(c => c.id !== cat.id)); draw();
            },
          }, 'Delete'));
      }));
      if (!state.categories.length) list.append(el('p', {}, 'No categories yet.'));
    };
    const add = el('input', { type: 'text', placeholder: 'New category', maxlength: '40' });
    const addIt = async () => {
      const cat = newCategory(add.value); if (!cat) return;
      if (!state.categories.some(c => c.id === cat.id)) await saveCategories([...state.categories, cat]);
      add.value = ''; draw(); add.focus();
    };
    add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
    draw();
    f.append(el('h2', {}, 'Categories'),
      el('p', {}, 'Each entry can have one category, like a section of a notebook. Use tags for everything else. Click a colour to change it.'),
      list,
      el('div', { class: 'cat-add' }, add, el('button', { type: 'button', class: 'btn-plain', onclick: addIt }, 'Add')),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-ink', onclick: () => done() }, 'Done')));
  });
}

// --- links between entries
/** Turn stored entry links into clickable chips showing the linked entry's current title. */
function decorateLinks(root = body) {
  for (const a of root.querySelectorAll('a[href^="wellwrite:entry/"]')) {
    const id = a.getAttribute('href').slice('wellwrite:entry/'.length);
    const m = metaById(id);
    a.className = 'xref' + (m ? '' : ' broken');
    a.contentEditable = 'false';
    if (m) a.textContent = entryLabel(m);
    a.title = m ? `Open “${entryLabel(m)}”, ${fmt(m.date, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'This entry has been deleted';
  }
}

function followLink(a) {
  const id = a.getAttribute('href').slice('wellwrite:entry/'.length);
  if (!metaById(id)) { toast('That entry has been deleted'); return; }
  openEntry(id, { via: 'link' });
}

function renderBackLink() {
  const b = $('#backLink');
  const prev = metaById(state.trail[state.trail.length - 1]);
  if (!prev) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = ICON.back;
  b.append(`Back to ${entryLabel(prev)}`);
  b.onclick = () => openEntry(state.trail.pop(), { via: 'back' });
}

function caretRect(range) {
  const r = range.getBoundingClientRect();
  if (r && (r.top || r.left)) return r;
  const tmp = document.createElement('span'); tmp.textContent = '​';
  const rr = range.cloneRange(); rr.insertNode(tmp);
  const out = tmp.getBoundingClientRect(); tmp.remove();
  return out;
}

function openLinkPicker() {
  if (!state.current) return;
  const sel = getSelection();
  let range = sel.rangeCount && body.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  if (!range) { range = document.createRange(); range.selectNodeContents(body); range.collapse(false); }
  const query0 = range.collapsed ? '' : range.toString().trim();
  const rect = caretRect(range.cloneRange());

  const insert = (id, label) => {
    closePopover();
    body.focus();
    // A plain space right before the link would be swallowed by the browser; make it a fixed one.
    const n = range.startContainer, o = range.startOffset;
    if (range.collapsed && n.nodeType === 3 && o > 0 && n.data[o - 1] === ' ') {
      n.replaceData(o - 1, 1, '\u00a0');
      range.setStart(n, o); range.collapse(true); // replaceData moves the caret back one; put it after the space
    }
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('insertHTML', false, `<a href="wellwrite:entry/${id}">${esc(label)}</a>&nbsp;`);
    decorateLinks(); markDirty();
  };

  showPopover(rect, pop => {
    pop.classList.add('picker');
    const input = el('input', { class: 'pop-search', placeholder: 'Find an entry to link to', value: query0, 'aria-label': 'Find an entry' });
    const list = el('div', { class: 'pop-list', role: 'listbox' });
    let items = [], active = 0;
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const scored = state.metas.filter(m => m.id !== state.current.id).map(m => {
        const t = (m.title || '').toLowerCase();
        const s = !q ? 1 : t.startsWith(q) ? 4 : t.includes(q) ? 3 : m.tags.some(x => x.includes(q)) ? 2 : m.text.toLowerCase().includes(q) ? 1 : 0;
        return { m, s };
      }).filter(x => x.s).sort((a, b) => b.s - a.s || (b.m.date + b.m.time).localeCompare(a.m.date + a.m.time)).slice(0, 8);
      items = scored.map(x => ({ kind: 'entry', m: x.m }));
      if (q && !state.metas.some(m => (m.title || '').toLowerCase() === q)) items.push({ kind: 'new', title: input.value.trim() });
      active = Math.min(active, Math.max(0, items.length - 1));
      list.replaceChildren(...items.map((it, i) => {
        const b = el('button', { type: 'button', class: 'pop-item' + (i === active ? ' on' : ''), role: 'option', onmousemove: () => { if (active !== i) { active = i; draw(); } }, onclick: () => choose(it) });
        if (it.kind === 'new') b.append(el('span', { class: 'pop-new' }, '+'), el('span', { class: 'pop-title' }, `Create “${it.title}” and link to it`));
        else {
          const cat = catById(it.m.category);
          b.append(el('span', { class: 'dot', style: cat ? `background:${cat.color}` : '' }), el('span', { class: 'pop-title' }, entryLabel(it.m)),
            el('small', {}, fmt(it.m.date, { day: 'numeric', month: 'short', year: 'numeric' })));
        }
        return b;
      }));
      if (!items.length) list.append(el('p', { class: 'pop-empty' }, state.metas.length > 1 ? 'No entries match.' : 'Write a few more entries, then you can link them together.'));
    };
    const choose = async it => {
      if (!it) return;
      if (it.kind === 'entry') return insert(it.m.id, entryLabel(it.m));
      // Create a new, empty entry to link to (it opens when you click the link).
      try {
        const meta = await api.save({ id: crypto.randomUUID(), date: todayISO(), time: nowTime(), title: it.title, tags: [], category: state.current.category || '', html: '', text: '' });
        state.metas.push(meta);
        insert(meta.id, entryLabel(meta));
        renderSidebar();
      } catch (x) { toast(x.message); }
    };
    input.addEventListener('input', () => { active = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, items.length); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + items.length) % Math.max(1, items.length); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); closePopover(); body.focus(); sel.removeAllRanges(); sel.addRange(range); }
    });
    pop.append(input, list, el('p', { class: 'pop-hint' }, '↑ ↓ to choose, Enter to link, Esc to cancel'));
    draw();
    setTimeout(() => { input.focus(); input.select(); });
  });
}

// Typing [[ opens the link picker.
body.addEventListener('input', e => {
  if (e.inputType !== 'insertText' || !e.data || !e.data.endsWith('[')) return;
  const sel = getSelection(); if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0), node = r.startContainer, off = r.startOffset;
  if (node.nodeType !== 3 || off < 2 || node.data.slice(off - 2, off) !== '[[') return;
  const del = document.createRange(); del.setStart(node, off - 2); del.setEnd(node, off);
  del.deleteContents();
  openLinkPicker();
});

// --- connections panel under each entry
function renderConnections() {
  const box = $('#connections'), c = state.current;
  if (!c) { box.hidden = true; return; }
  const self = metaById(c.id);
  const out = (self ? self.links : []).map(metaById).filter(Boolean);
  const outIds = new Set(out.map(m => m.id));
  const from = sorted(state.metas.filter(m => m.id !== c.id && m.links && m.links.includes(c.id)));
  const fromIds = new Set(from.map(m => m.id));
  const related = c.tags.length ? state.metas
    .filter(m => m.id !== c.id && !outIds.has(m.id) && !fromIds.has(m.id))
    .map(m => ({ m, shared: m.tags.filter(t => c.tags.includes(t)) }))
    .filter(x => x.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length || (b.m.date + b.m.time).localeCompare(a.m.date + a.m.time))
    .slice(0, 5) : [];

  const item = (m, note) => {
    const cat = catById(m.category);
    return el('button', { type: 'button', class: 'conn-item', onclick: () => openEntry(m.id, { via: 'link' }) },
      el('span', { class: 'dot', style: cat ? `background:${cat.color}` : '' }),
      el('span', { class: 'conn-title' }, entryLabel(m)),
      el('small', {}, note || fmt(m.date, { day: 'numeric', month: 'short', year: 'numeric' })));
  };
  const group = (title, list) => list.length ? el('div', { class: 'conn-group' }, el('h3', {}, title), ...list) : null;
  const groups = [
    group(from.length === 1 ? 'Linked from 1 entry' : `Linked from ${from.length} entries`, from.map(m => item(m))),
    group('Links to', out.map(m => item(m))),
    group('Shares tags with', related.map(x => item(x.m, x.shared.map(t => '#' + t).join(' ')))),
  ].filter(Boolean);
  box.hidden = !groups.length;
  box.replaceChildren(...groups);
}

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
  { k: 'link', title: 'Web link (Ctrl+K)', run: insertLink, on: () => !!closest('A') },
  { k: 'xref', title: 'Link to another entry (type [[)', run: () => openLinkPicker() },
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
  const x = e.target.closest('a.xref');
  if (x) { e.preventDefault(); followLink(x); return; }
  const a = e.target.closest('a');
  if (a && (e.ctrlKey || e.metaKey) && a.href) { e.preventDefault(); api.openExternal(a.href); }
  if (e.target.tagName === 'IMG') {
    const r = document.createRange(); r.selectNode(e.target);
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
});
body.addEventListener('mouseover', e => { const a = e.target.closest('a:not(.xref)'); if (a) a.title = 'Ctrl+click to open ' + a.getAttribute('href'); });
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

function openSettings(section) {
  if (section) setTimeout(() => { const h = document.getElementById('set-' + section); if (h) h.scrollIntoView({ block: 'start' }); }, 30);
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
      row('Categories', 'Group entries into sections, like a notebook.', el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); manageCategories(); } }, 'Edit categories')),
      row('Check spelling', 'Underlines misspelled words. Right-click for suggestions.', check(s.spellcheck, v => updateSetting({ spellcheck: v }))),

      el('h3', {}, 'Privacy'),
      row('Lock after inactivity', null, select(s.autoLockMinutes, [['1', '1 minute'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['0', 'Never']], v => updateSetting({ autoLockMinutes: +v }))),
      row('Lock when minimised', 'Also locks when Windows locks or the computer sleeps.', check(s.lockOnMinimize, v => updateSetting({ lockOnMinimize: v }))),
      row('Password', null, el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); changePassword(); } }, 'Change password')),

      el('h3', { id: 'set-backups' }, 'Backups'),
      el('p', {}, 'Backups are encrypted with your password, so they are safe to keep online or on a USB drive.'),
      el('div', { id: 'backupSection' }),
      el('div', { class: 'btns', style: 'margin-top:14px' },
        el('button', { type: 'button', class: 'btn-plain', onclick: doBackup }, 'Save a backup file'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); doImport(); } }, 'Import a backup file'),
        state.backup && state.backup.google.connected
          ? el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); restoreFromDrive('import'); } }, 'Restore from Google Drive') : null,
        el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); doExportReadable(); } }, 'Export readable copy')),
      el('p', { class: 'path', style: 'margin-top:14px' }, 'Journal folder: ', state.dataDir, ' ',
        el('button', { type: 'button', class: 'btn-link', onclick: () => api.showDataFolder() }, 'Show folder')),

      el('h3', {}, 'About'),
      el('div', { class: 'row' }, el('div', {}, 'WellWrite ' + state.version, el('small', { id: 'updStatus' }, 'Updates install automatically when you restart.')),
        el('button', { type: 'button', class: 'btn-plain', onclick: checkUpdates }, 'Check for updates')),

      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-ink', onclick: () => done() }, 'Done')),
    );
    renderBackupSection();
    refreshBackupInfo();
  });
}

async function checkUpdates() {
  const out = $('#updStatus'); out.textContent = 'Checking…';
  const r = await api.checkUpdates().catch(() => ({ status: 'offline' }));
  out.textContent = {
    dev: 'Updates are only checked in the installed app.',
    ready: `Version ${r.version} is ready. Restart WellWrite to install it.`,
    downloading: `Downloading version ${r.version}. You'll be asked to restart when it's ready.`,
    latest: 'You have the latest version.',
    offline: "Couldn't reach the update server. Check your connection and try again.",
  }[r.status];
}

function showUpdate(version) {
  $('#updateText').textContent = `WellWrite ${version} is ready to install.`;
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


/* ---------- automatic backups & Google Drive ---------- */
state.backup = null;
state.connecting = false;
const shownErrors = new Set();

async function refreshBackupInfo() {
  try { state.backup = await api.backupInfo(); } catch { return; }
  renderBackupCard();
  renderBackupSection();
}

function whenText(iso) {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = isoOf(d), y = new Date(now); y.setDate(now.getDate() - 1);
  if (day === isoOf(now)) return `today at ${t}`;
  if (day === isoOf(y)) return `yesterday at ${t}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} at ${t}`;
}

/** A destination's latest failure, if it happened after its latest success. */
function destProblem(st) {
  if (!st || !st.lastError || !st.lastErrorAt) return null;
  if (st.lastAt && new Date(st.lastAt) > new Date(st.lastErrorAt)) return null;
  return st;
}
const DEST_LABEL = { google: 'Google Drive', folder: 'This computer' };
const enabledDests = s => ['google', 'folder'].filter(d => (d === 'google' ? s.backupToGoogle : s.backupToFolder));

function renderBackupCard() {
  const card = $('#backupCard'), b = state.backup;
  if (!card) return;
  if (!b || !state.unlocked) { card.hidden = true; return; }
  const s = b.settings, on = enabledDests(s);
  const btn = (label, cls, fn) => el('button', { class: cls, onclick: fn }, label);
  let content = null;
  const reauth = s.backupToGoogle && destProblem(b.status.google) && b.status.google.lastErrorCode === 'reauth';
  const stale = on.find(d => destProblem(b.status[d]) && (!b.status[d].lastAt || Date.now() - new Date(b.status[d].lastAt) > 3 * 864e5));
  if (reauth) {
    content = [el('span', {}, 'Google Drive needs reconnecting. Backups to Drive are paused until you do.'),
      el('span', { class: 'card-btns' }, btn('Reconnect', 'btn-foil btn-small', () => openSettings('backups')))];
  } else if (stale) {
    const st = b.status[stale], where = stale === 'google' ? 'Google Drive' : 'your backup folder';
    content = [el('span', {}, st.lastAt ? `Backups to ${where} haven't worked since ${whenText(st.lastAt)}.` : `Your journal hasn't been backed up to ${where} yet.`),
      el('span', { class: 'card-btns' }, btn('See why', 'btn-foil btn-small', () => openSettings('backups')))];
  } else if (!on.length && !s.backupNudgeDismissed && state.metas.length >= 3) {
    content = [el('span', {}, b.google.available
      ? 'Back up your journal to Google Drive or this computer, so it survives a lost or broken computer.'
      : 'Turn on automatic backups, so your journal survives a lost or broken computer.'),
      el('span', { class: 'card-btns' },
        btn('Set up backups', 'btn-foil btn-small', () => openSettings('backups')),
        btn('Not now', 'btn-link', async () => { await updateSetting({ backupNudgeDismissed: true }); refreshBackupInfo(); }))];
  }
  card.hidden = !content;
  if (content) card.replaceChildren(...content);
}

function destStatusLine(b, dest) {
  const st = b.status[dest], problem = destProblem(st);
  if (b.running) return el('p', { class: 'dest-status' }, 'Backing up…');
  if (problem) return el('p', { class: 'dest-status bad' }, `Last backup failed ${whenText(problem.lastErrorAt)}: ${problem.lastError}`);
  if (st.lastAt) return el('p', { class: 'dest-status ok' }, `Last backup ${whenText(st.lastAt)}, ${plainEntries(st.lastCount)}.`);
  if (b.blockers[dest]) return null;
  return el('p', { class: 'dest-status' }, 'No backups here yet. The first one runs shortly.');
}

function renderBackupSection() {
  const box = document.getElementById('backupSection');
  const b = state.backup;
  if (!box || !b) return;
  const s = b.settings, g = b.google;
  const button = (label, cls, fn) => el('button', { type: 'button', class: cls, onclick: fn }, label);
  const tick = (checked, on, disabled) => { const c = el('input', { type: 'checkbox', onchange: e => on(e.target.checked, e.target) }); c.checked = checked; c.disabled = !!disabled; return c; };

  // --- Google Drive
  let gDetail, gAction = null;
  if (!g.available) gDetail = "Not available in this version of WellWrite yet.";
  else if (state.connecting) { gDetail = 'Finish signing in to Google in your browser…'; gAction = button('Cancel', 'btn-plain', () => api.googleCancel()); }
  else if (g.connected) { gDetail = `${g.email || 'Connected'}. Backups go in the "WellWrite backups" folder in your Drive.`; gAction = button('Disconnect', 'btn-link', disconnectDrive); }
  else { gDetail = 'Not connected. WellWrite can only see the backups it puts in your Drive.'; gAction = button('Connect Google Drive', 'btn-ink', connectDrive); }
  const gTick = tick(s.backupToGoogle, async (on, box) => {
    if (on && !g.connected) { box.checked = false; return connectDrive(); }
    await updateSetting({ backupToGoogle: on }); refreshBackupInfo();
  }, !g.available);
  const google = el('div', { class: 'dest' },
    el('label', { class: 'dest-head' }, gTick, el('span', {}, 'Google Drive')),
    el('div', { class: 'dest-body' }, el('div', { class: 'dest-row' }, el('small', {}, gDetail), gAction),
      s.backupToGoogle ? destStatusLine(b, 'google') : null));

  // --- This computer
  const fTick = tick(s.backupToFolder, async (on, box) => {
    if (on && !s.backupDir) { box.checked = false; return chooseFolder(); }
    await updateSetting({ backupToFolder: on }); refreshBackupInfo();
  });
  const sugg = b.suggestions.filter(x => x.path !== s.backupDir);
  const folder = el('div', { class: 'dest' },
    el('label', { class: 'dest-head' }, fTick, el('span', {}, 'This computer')),
    el('div', { class: 'dest-body' },
      el('div', { class: 'dest-row' },
        el('small', {}, s.backupDir || 'A folder on this computer, a USB drive or a network drive.'),
        el('span', { class: 'row-ctl' },
          s.backupDir ? button('Open', 'btn-link', () => api.showBackupFolder()) : null,
          button(s.backupDir ? 'Change folder' : 'Choose folder', 'btn-plain', () => chooseFolder()))),
      sugg.length ? el('p', { class: 'note' }, 'Or use your ',
        ...sugg.map((x, i) => [i ? ' or ' : '', button(x.label, 'btn-link', () => chooseFolder(x.path))]).flat(), ' folder.') : null,
      s.backupToFolder ? destStatusLine(b, 'folder') : null));

  const row = (label, help, control) => el('div', { class: 'row' }, el('div', { class: 'row-text' }, label, help ? el('small', {}, help) : null), el('span', { class: 'row-ctl' }, control));
  const select = (val, opts, key, cast = x => x) => {
    const sel = el('select', { onchange: async e => { await updateSetting({ [key]: cast(e.target.value) }); refreshBackupInfo(); } },
      ...opts.map(([v, l]) => el('option', { value: v }, l)));
    sel.value = String(val); return sel;
  };
  const on = enabledDests(s);
  const nowBtn = button(on.length > 1 ? 'Back up to both now' : 'Back up now', 'btn-ink', backupNow);
  if (!on.length || b.running || on.every(d => b.blockers[d])) nowBtn.disabled = true;

  box.replaceChildren(...[
    el('p', { class: 'dest-intro' }, 'Back up automatically to:'),
    g.available ? google : null, folder,
    row('How often', 'Only when something has changed.', select(s.backupEvery, [['daily', 'Once a day'], ['weekly', 'Once a week'], ['close', 'Each time I close WellWrite']], 'backupEvery')),
    row('Backups to keep', g.available ? 'In each place. Older automatic backups are removed.' : 'Older automatic backups are removed.', select(s.backupKeep, [['5', 'Newest 5'], ['10', 'Newest 10'], ['30', 'Newest 30'], ['0', 'All of them']], 'backupKeep', Number)),
    el('div', { class: 'backup-status' },
      el('span', { id: 'backupLine' }, on.length ? `Backing up to ${on.map(d => (d === 'google' ? 'Google Drive' : 'this computer')).join(' and ')}.` : 'Automatic backups are off. Tick a place above to turn them on.'),
      nowBtn),
  ].filter(Boolean));
}

async function connectDrive() {
  state.connecting = true; renderBackupSection();
  try {
    state.backup = await api.googleConnect();
    toast('Google Drive connected. Your first backup starts now.');
  } catch (x) {
    if (!/cancel/i.test(x.message)) toast(x.message);
  }
  state.connecting = false;
  refreshBackupInfo();
}

async function disconnectDrive() {
  const ok = await confirmDialog({ title: 'Disconnect Google Drive?', text: 'Backups to Google Drive will stop. Backups already in your Drive stay there.', ok: 'Disconnect' });
  if (ok) {
    try { await api.googleDisconnect(); await updateSetting({ backupToGoogle: false }); toast('Google Drive disconnected'); } catch (x) { toast(x.message); }
  }
  await refreshBackupInfo();
  openSettings('backups');
}

async function chooseFolder(suggested) {
  try { state.backup = await api.chooseBackupFolder(suggested); } catch (x) { toast(x.message); }
  refreshBackupInfo();
}

async function backupNow() {
  await saveNow();
  const line = document.getElementById('backupLine');
  if (line) line.textContent = 'Backing up…';
  const r = await api.backupNow().catch(x => ({ ok: false, error: x.message }));
  toast(r.ok ? `Backed up ${plainEntries(r.count)} to ${r.where}` : (r.where ? `Backed up to ${r.where}, but ` : 'Backup failed. ') + r.error);
  refreshBackupInfo();
}

api.onBackupResult(r => {
  if (!r.ok && r.reason !== 'manual' && state.unlocked && !shownErrors.has(r.error)) {
    shownErrors.add(r.error);
    toast('Backup failed: ' + r.error);
  }
  refreshBackupInfo();
});

/** Pick a backup in Google Drive and restore it ('fresh' at setup) or merge it ('import'). */
async function restoreFromDrive(mode) {
  let info = await api.backupInfo().catch(() => null);
  if (!info || !info.google.available) { toast('Google Drive is not available in this version'); return; }
  if (!info.google.connected) {
    const waiting = openDialog((f, done) => f.append(
      el('h2', {}, 'Sign in to Google'),
      el('p', {}, 'Finish signing in in the browser window that just opened, then come back here.'),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-plain', autofocus: true, onclick: () => { api.googleCancel(); done(); } }, 'Cancel'))));
    try { await api.googleConnect(); } catch (x) { $('#dlg').close(); if (!/cancel/i.test(x.message)) toast(x.message); return; }
    $('#dlg').close(); await waiting;
  }
  let files;
  try { files = await api.googleList(); } catch (x) { toast(x.message); return; }
  if (!files.length) {
    await confirmDialog({ title: 'No backups found', text: 'There are no WellWrite backups in the "WellWrite backups" folder of this Google account.', ok: 'OK' });
    return;
  }
  const fmtSize = n => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
  return openDialog((f, done) => {
    const list = el('div', { class: 'pick-list' }, ...files.map((x, i) => {
      const r = el('input', { type: 'radio', name: 'bk', value: x.id }); if (!i) r.checked = true;
      const d = new Date(x.created);
      return el('label', { class: 'pick' }, r,
        el('span', {}, d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })),
        el('small', {}, fmtSize(x.size)));
    }));
    const pw = el('input', { type: 'password', autocomplete: 'off' });
    const err = el('p', { class: 'err', role: 'alert' });
    const go = el('button', { type: 'submit', class: 'btn-ink' }, mode === 'fresh' ? 'Restore' : 'Import');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pw.value) { err.textContent = 'Enter the password for this backup.'; pw.focus(); return; }
      const id = list.querySelector('input:checked').value;
      go.disabled = true; go.textContent = 'Downloading…';
      try {
        if (mode === 'fresh') {
          const n = await api.googleRestoreFresh(id, pw.value);
          done(); await enterApp(); toast(`Restored ${plainEntries(n)} from Google Drive`);
        } else {
          await saveNow();
          const r = await api.googleImport(id, pw.value);
          done(); state.metas = await api.list(); renderSidebar();
          toast(r.added || r.updated ? `Imported: ${r.added} new, ${r.updated} updated` : 'Nothing new in that backup');
        }
      } catch (x) { err.textContent = x.message; go.disabled = false; go.textContent = mode === 'fresh' ? 'Restore' : 'Import'; }
    });
    f.append(
      el('h2', {}, mode === 'fresh' ? 'Restore from Google Drive' : 'Import from Google Drive'),
      el('p', {}, mode === 'fresh'
        ? 'Choose a backup. Its password becomes your journal password.'
        : 'Entries from the backup are added to this journal. Where both have the same entry, the newer version is kept.'),
      list,
      el('label', { class: 'field' }, 'Password used for that backup', pw), err,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-plain', onclick: () => done() }, 'Cancel'), go));
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
api.version().then(v => {
  state.version = v.version;
  const b = $('#versionBtn'); b.textContent = 'v' + v.version; b.hidden = false;
  if (v.updateReady) showUpdate(v.updateReady);
}).catch(() => {});
$('#versionBtn').addEventListener('click', async () => {
  const b = $('#versionBtn');
  b.textContent = 'Checking…';
  const r = await api.checkUpdates().catch(() => ({ status: 'offline' }));
  b.textContent = 'v' + state.version;
  if (r.status === 'ready') showUpdate(r.version);
  toast({
    dev: `WellWrite ${state.version}. Updates are only checked in the installed app.`,
    ready: `WellWrite ${r.version} is ready. Restart to install it.`,
    downloading: `Downloading WellWrite ${r.version}. You'll be asked to restart when it's ready.`,
    latest: `You have the latest version, WellWrite ${state.version}.`,
    offline: "Couldn't check for updates. Check your internet connection.",
  }[r.status]);
});
api.onLock(() => lockNow());
window.addEventListener('blur', () => saveNow());

boot();
