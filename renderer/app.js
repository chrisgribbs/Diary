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
  categories: [],       // [{ id, name, color, parent }]
  sideView: (() => { try { return localStorage.getItem('sideView') || 'calendar'; } catch { return 'calendar'; } })(),
  openCats: new Set(),  // collapsed state of the category tree (ids that are folded)
  trail: [],            // entries visited by following links, for "Back"
  quotes: [],           // [{ id, text, author, source, fav }]
  quoteSkip: {},        // date -> how many times "Another" was pressed today
  promptSkip: {},       // date -> how many times "Another question" was pressed
  mode: (() => { try { return localStorage.getItem('mode') || 'journal'; } catch { return 'journal'; } })(),
  bible: null,          // { plans, translations, state: { plan, translation, start, done } }
  bibleDay: null,       // day of the plan being viewed (0-based); null = today's
  verseCache: {},
  weekAt: null,         // a day in the week shown on the weekly page (null = this week)
  pictures: {},         // week picture key -> data URL ('' = none), loaded as needed
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
  // Let dialog builders pass null for optional parts without it showing up as text.
  form.append = (...kids) => HTMLFormElement.prototype.append.apply(form, kids.filter(k => k != null));
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
  // Remembered password: open straight away.
  if (s.exists && s.trust && s.trust.active) {
    try { if (await api.unlockTrusted()) { await enterApp(); return; } } catch {}
  }
  showLock(s.exists);
}

function showLock(exists, trust) {
  state.unlocked = false;
  $('#app').hidden = true;
  $('#lock').hidden = false;
  const remembered = exists && trust && trust.active;
  $('#trustForm').hidden = !remembered;
  $('#unlockForm').hidden = !exists || remembered;
  $('#setupForm').hidden = exists;
  $('#unlockErr').textContent = $('#setupErr').textContent = $('#trustErr').textContent = '';
  $('#unlockPw').value = $('#setupPw').value = $('#setupPw2').value = '';
  hideAllPasswords($('#lock'));
  if (remembered) {
    $('#trustText').textContent = trust.mode === 'hour'
      ? `No password needed until ${new Date(trust.until).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.`
      : 'This computer is trusted, so no password is needed.';
  }
  setTimeout(() => (remembered ? $('#trustOpen') : exists ? $('#unlockPw') : $('#setupPw')).focus(), 50);
}

$('#trustOpen').addEventListener('click', async () => {
  try {
    if (await api.unlockTrusted()) { await enterApp(); return; }
  } catch {}
  // The remembered password has run out (or no longer matches): ask for it.
  showLock(true);
  $('#unlockErr').textContent = 'Please enter your password.';
});
$('#trustUsePw').addEventListener('click', () => { showLock(true); });

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
  try { state.quotes = await api.getQuotes(); } catch { state.quotes = []; }
  await syncReadings();
  try { state.bible = await api.bibleInfo(); } catch { state.bible = null; }
  state.bibleDay = null;
  state.selectedDay = null; state.query = ''; state.tag = null; state.category = null; state.trail = []; $('#search').value = '';
  const d = new Date(); state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  $('#lock').hidden = true;
  $('#app').hidden = false;
  const today = sorted(state.metas.filter(m => m.date === todayISO()))[0];
  const mode = state.mode;
  if (today) await openEntry(today.id, { keepMode: true }); else showEmpty();
  state.mode = mode;
  renderSidebar();
  refreshBackupInfo();
  setMode(state.mode);
}

async function lockNow() {
  if (!state.unlocked) return;
  await saveNow();
  state.unlocked = false;
  try { await api.lock(); } catch {}
  // Wipe everything readable from the page.
  state.metas = []; state.current = null; state.categories = []; state.trail = []; state.quotes = []; state.bible = null; state.verseCache = {}; state.pictures = {}; state.weekAt = null;
  $('#bibleView').replaceChildren(); $('#quoteView').replaceChildren();
  closePopover();
  $('#body').innerHTML = ''; $('#title').value = ''; $('#tagChips').replaceChildren();
  $('#list').replaceChildren(); $('#calGrid').replaceChildren(); $('#search').value = '';
  if ($('#dlg').open) $('#dlg').close();
  $('#lightbox').hidden = true;
  let trust = null;
  try { trust = (await api.status()).trust; } catch {}
  showLock(true, trust);
}

/* ---------- entries: list + filtering ---------- */
const plainEntries = n => n === 1 ? '1 entry' : `${n.toLocaleString()} entries`;
const sorted = list => [...list].sort((a, b) => (b.date + b.time + b.created).localeCompare(a.date + a.time + a.created));

function matches(m) {
  if (state.selectedDay && m.date !== state.selectedDay) return false;
  if (state.tag && !m.tags.includes(state.tag)) return false;
  if (state.category != null && !inCategory(m, state.category)) return false;
  if (state.query) {
    const cat = catById(m.category);
    const hay = (m.title + ' ' + m.tags.map(t => '#' + t).join(' ') + ' ' + (cat ? catPath(cat) : '') + ' ' + m.text).toLowerCase();
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
    if (cat) title.prepend(el('span', { class: 'dot', style: `background:${cat.color}`, title: catPath(cat) }));
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

function tagCounts() {
  const counts = new Map();
  for (const m of state.metas) for (const t of m.tags) counts.set(t, (counts.get(t) || 0) + 1);
  return counts;
}

function renderTags() {
  const counts = tagCounts();
  $('#tagList').replaceChildren(...[...counts.keys()].sort().map(t => el('option', { value: t })));
  if (state.sideView !== 'tags') return;
  const q = $('#tagFind').value.trim().toLowerCase().replace(/^#/, '');
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = all.filter(([t]) => !q || t.includes(q));
  const box = $('#tagTree');
  if (!all.length) {
    box.replaceChildren(el('p', { class: 'side-empty' }, 'No tags yet. Add tags under an entry’s title, like #family or #ideas. They’ll be listed here so you can find every entry with that tag.'));
    return;
  }
  box.replaceChildren(...shown.map(([t, n]) => el('button', {
    class: 'side-row' + (state.tag === t ? ' on' : ''), 'aria-pressed': String(state.tag === t),
    onclick: () => { state.tag = state.tag === t ? null : t; state.selectedDay = null; renderSidebar(); },
  }, el('span', { class: 'hash' }, '#'), el('span', { class: 'side-name' }, t), el('small', {}, String(n)))));
  if (!shown.length) box.append(el('p', { class: 'side-empty' }, `No tags match “${q}”.`));
}
$('#tagFind').addEventListener('input', renderTags);
$('#tagFind').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; renderTags(); }
  if (e.key === 'Enter') { const first = $('#tagTree .side-row'); if (first) first.click(); }
});

function renderSideTabs() {
  for (const b of document.querySelectorAll('.sidetabs [data-view]')) {
    const on = b.dataset.view === state.sideView;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  }
  $('#viewCalendar').hidden = state.sideView !== 'calendar';
  $('#viewCategories').hidden = state.sideView !== 'categories';
  $('#viewTags').hidden = state.sideView !== 'tags';
}
for (const b of document.querySelectorAll('.sidetabs [data-view]')) {
  b.addEventListener('click', () => {
    state.sideView = b.dataset.view;
    try { localStorage.setItem('sideView', state.sideView); } catch {}
    renderSidebar();
    if (state.sideView === 'tags') $('#tagFind').focus();
  });
}

function renderFilterNote() {
  const note = $('#filterNote');
  const parts = [];
  if (state.selectedDay) parts.push(fmt(state.selectedDay, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  if (state.category != null) parts.push(state.category ? catPath(catById(state.category)) : 'no category');
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

function renderSidebar() { renderSideTabs(); renderCalendar(); renderOnThisDay(); renderCategoryTree(); renderTags(); renderFilterNote(); renderList(); renderStats(); renderBackupCard(); }

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
  box.replaceChildren(...[
    el('div', { class: 'daily-slot', id: 'emptyDaily' }),
    el('h2', {}, first ? 'Your first page is blank.' : fmt(todayISO(), { weekday: 'long', day: 'numeric', month: 'long' })),
    el('p', {}, first
      ? 'Write about today, or anything at all. Entries are encrypted with your password and stay on this computer.'
      : 'Nothing written yet today. A few lines is enough.'),
    el('button', { class: 'btn-ink', onclick: () => newEntry(todayISO()) }, 'Write today’s entry'),
  ].filter(Boolean));
  fillDaily($('#emptyDaily'), todayISO(), 'empty');
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

async function openEntry(id, { via, keepMode } = {}) {
  if (state.mode !== 'journal' && !keepMode) setMode('journal');
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
  renderStamp(); renderChips(); renderCategoryPill(); showSheet(); updateCounts(); renderConnections(); renderBackLink(); renderQuoteSlot();
  $('#saveState').textContent = 'Saved';
  $('#sheetScroll').scrollTop = 0;
  const d = dateOf(e.date);
  if (d.getMonth() !== state.viewMonth.getMonth() || d.getFullYear() !== state.viewMonth.getFullYear()) {
    state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1); renderCalendar();
  }
  document.querySelectorAll('#list .item').forEach(n => n.classList.toggle('active', n.dataset.id === id));
}

async function newEntry(date = todayISO()) {
  if (state.mode !== 'journal') setMode('journal');
  await saveNow();
  state.current = { id: crypto.randomUUID(), date, time: date === todayISO() ? nowTime() : '', title: '', tags: [], category: catById(state.category) ? state.category : '', saved: false };
  state.trail = [];
  titleIn.value = dateTitle(date); body.innerHTML = '';
  renderStamp(); renderChips(); renderCategoryPill(); showSheet(); updateCounts(); renderConnections(); renderBackLink(); renderQuoteSlot();
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
const topCats = () => state.categories.filter(c => !c.parent);
const subCats = id => state.categories.filter(c => c.parent === id);
/** "Work › Projects" for a subcategory, "Work" for a category. */
const catPath = cat => { if (!cat) return ''; const p = catById(cat.parent); return p ? `${p.name} › ${cat.name}` : cat.name; };
/** Does entry m belong to category id (or one of its subcategories)? '' means "no category". */
function inCategory(m, id) {
  const own = catById(m.category);
  if (id === '') return !own;
  return !!own && (own.id === id || own.parent === id);
}
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

/** A new category object (not yet saved). Reuses an existing one with the same name and parent. */
function newCategory(name, parent = '') {
  name = String(name || '').trim().slice(0, 40);
  if (!name) return null;
  const existing = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase() && (c.parent || '') === parent);
  if (existing) return existing;
  const p = catById(parent);
  const used = state.categories.map(c => c.color);
  const color = p ? p.color : (CAT_COLORS.find(c => !used.includes(c)) || CAT_COLORS[state.categories.length % CAT_COLORS.length]);
  return { id: 'c-' + crypto.randomUUID().slice(0, 8), name, color, parent: p ? p.id : '' };
}

/** Create from typed text. "Work / Meetings" makes Meetings a subcategory of Work (creating Work if needed). */
async function createCategoryFromText(text) {
  const [a, b] = String(text).split(/\s*[\/›>]\s*/).map(x => x.trim()).filter(Boolean);
  if (!a) return null;
  let list = [...state.categories];
  let parent = list.find(c => !c.parent && c.name.toLowerCase() === a.toLowerCase()) || newCategory(a);
  if (!list.includes(parent)) list.push(parent);
  let target = parent;
  if (b) {
    target = list.find(c => c.parent === parent.id && c.name.toLowerCase() === b.toLowerCase()) || newCategory(b, parent.id);
    if (!target.parent) target = { ...target, parent: parent.id, color: parent.color };
    if (!list.some(c => c.id === target.id)) list.push(target);
  }
  if (list.length !== state.categories.length) await saveCategories(list);
  return catById(target.id) || target;
}

function renderCategoryPill() {
  const pill = $('#catPill'), c = state.current;
  if (!pill || !c) return;
  const cat = catById(c.category);
  pill.classList.toggle('is-empty', !cat);
  pill.replaceChildren(el('span', { class: 'dot', style: cat ? `background:${cat.color}` : '' }), cat ? catPath(cat) : 'Add a category');
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
    const current = catById(c.category) ? c.category : '';
    const opt = (cat, label, sub) => el('button', {
      type: 'button', class: 'menu-item' + (sub ? ' sub' : '') + ((cat ? cat.id : '') === current ? ' on' : ''),
      onclick: () => { setEntryCategory(cat ? cat.id : ''); closePopover(); },
    }, el('span', { class: 'dot', style: cat ? `background:${cat.color}` : '' }), label);
    const items = [];
    for (const top of topCats()) {
      items.push(opt(top, top.name));
      for (const sub of subCats(top.id)) items.push(opt(sub, sub.name, true));
    }
    const box = el('div', { class: 'menu-scroll' }, ...items);
    pop.append(box);
    if (state.categories.length) pop.append(opt(null, 'No category'), el('hr'));
    const input = el('input', { class: 'pop-search', placeholder: state.categories.length ? 'New category, or Work / Meetings' : 'Name your first category', maxlength: '80' });
    const add = async text => {
      const cat = await createCategoryFromText(text); if (!cat) return;
      setEntryCategory(cat.id); closePopover();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); add(input.value); } });
    pop.append(input);
    if (!state.categories.length) {
      pop.append(el('div', { class: 'menu-suggest' }, 'Or pick one: ',
        ...['Personal', 'Work', 'Health', 'Family', 'Ideas'].map(n => el('button', { type: 'button', class: 'btn-link', onclick: () => add(n) }, n))));
    } else {
      pop.append(el('p', { class: 'pop-hint' }, 'Type “Work / Meetings” to make a subcategory.'),
        el('button', { type: 'button', class: 'menu-item subtle', onclick: () => { closePopover(); manageCategories(); } }, 'Edit categories…'));
    }
    setTimeout(() => input.focus());
  });
});

function renderCategoryTree() {
  if (state.sideView !== 'categories') return;
  const box = $('#viewCategories');
  const count = id => state.metas.filter(m => inCategory(m, id)).length;
  const row = (id, name, color, { sub = false, kids = 0 } = {}) => {
    const folded = state.openCats.has(id);
    return el('div', { class: 'side-row-wrap' + (sub ? ' sub' : '') },
      kids ? el('button', { class: 'fold', 'aria-label': folded ? `Show ${name}'s subcategories` : `Hide ${name}'s subcategories`, 'aria-expanded': String(!folded),
        onclick: () => { folded ? state.openCats.delete(id) : state.openCats.add(id); renderCategoryTree(); } }, folded ? '▸' : '▾') : el('span', { class: 'fold-space' }),
      el('button', {
        class: 'side-row' + (state.category === id ? ' on' : ''), 'aria-pressed': String(state.category === id),
        onclick: () => { state.category = state.category === id ? null : id; state.selectedDay = null; renderSidebar(); },
      }, el('span', { class: 'dot', style: color ? `background:${color}` : '' }), el('span', { class: 'side-name' }, name), el('small', {}, String(count(id)))));
  };
  const rows = [];
  for (const top of topCats()) {
    const kids = subCats(top.id);
    rows.push(row(top.id, top.name, top.color, { kids: kids.length }));
    if (!state.openCats.has(top.id)) for (const k of kids) rows.push(row(k.id, k.name, k.color, { sub: true }));
  }
  const input = el('input', { type: 'text', placeholder: state.categories.length ? 'New category, or Work / Meetings' : 'Name your first category', maxlength: '80', 'aria-label': 'New category' });
  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    const cat = await createCategoryFromText(input.value);
    if (cat && cat.parent) state.openCats.delete(cat.parent);
    renderCategoryTree();
    $('#viewCategories input').focus();
  });
  box.replaceChildren(...[
    el('div', { class: 'cattree' }, ...rows, state.categories.length ? row('', 'No category', '') : null),
    !state.categories.length ? el('p', { class: 'side-empty' }, 'Categories are like sections of a notebook, such as Work, Health or Family, and each can have subcategories. Give each entry one category from the button under its title.') : null,
    el('div', { class: 'catnew' }, input,
      state.categories.length ? el('button', { class: 'cat-edit', onclick: manageCategories }, 'Edit') : null),
  ].filter(Boolean));
}

function manageCategories() {
  return openDialog((f, done) => {
    const list = el('div', { class: 'cat-list' });
    const count = id => state.metas.filter(m => inCategory(m, id)).length;
    const update = async (id, patch) => { await saveCategories(state.categories.map(c => (c.id === id ? { ...c, ...patch } : c))); draw(); };
    const remove = async cat => {
      const kids = subCats(cat.id);
      if (cat.parent) await api.moveCategory(cat.id, cat.parent);           // subcategory: its entries move up to the parent
      else {
        for (const k of kids) await api.moveCategory(k.id, '');            // category: everything inside becomes uncategorised
        await api.moveCategory(cat.id, '');
      }
      state.metas = await api.list();
      const gone = new Set([cat.id, ...kids.map(k => k.id)]);
      if (state.current && gone.has(state.current.category)) state.current.category = cat.parent || '';
      if (gone.has(state.category)) state.category = null;
      await saveCategories(state.categories.filter(c => !gone.has(c.id))); draw();
    };
    const catRow = cat => {
      const kids = subCats(cat.id);
      const name = el('input', { type: 'text', value: cat.name, maxlength: '40', 'aria-label': 'Category name' });
      name.addEventListener('change', () => { const v = name.value.trim(); if (v && v !== cat.name) update(cat.id, { name: v }); else name.value = cat.name; });
      name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
      // Where it sits: top level, or under another top-level category (only if it has no subcategories itself).
      const under = el('select', { 'aria-label': `Where ${cat.name} sits`, title: kids.length ? 'This category has subcategories, so it stays at the top level' : 'Move under another category',
        onchange: e => update(cat.id, { parent: e.target.value, ...(e.target.value ? { color: catById(e.target.value).color } : {}) }) },
        el('option', { value: '' }, 'Top level'),
        ...topCats().filter(t => t.id !== cat.id).map(t => el('option', { value: t.id }, `Under ${t.name}`)));
      under.value = cat.parent || ''; under.disabled = kids.length > 0;
      const n = count(cat.id);
      const del = el('button', { type: 'button', class: 'btn-link danger', onclick: async e => {
        const btn = e.currentTarget;
        const what = cat.parent ? `${plainEntries(n)} will move to ${catById(cat.parent).name}` : kids.length ? `its ${kids.length} subcategor${kids.length === 1 ? 'y' : 'ies'} go too; ${plainEntries(n)} will have no category` : `${plainEntries(n)} will have no category`;
        if ((n || kids.length) && !btn.dataset.armed) {
          btn.dataset.armed = '1'; btn.textContent = `Delete? ${what}`;
          setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; } }, 5000);
          return;
        }
        remove(cat);
      } }, 'Delete');
      return el('div', { class: 'cat-row' + (cat.parent ? ' sub' : '') },
        el('button', { type: 'button', class: 'swatch', style: `background:${cat.color}`, title: 'Change colour', 'aria-label': `Change colour of ${cat.name}`,
          onclick: () => update(cat.id, { color: CAT_COLORS[(CAT_COLORS.indexOf(cat.color) + 1) % CAT_COLORS.length] }) }),
        name, under, el('small', {}, plainEntries(n)), del);
    };
    const draw = () => {
      const rows = [];
      for (const top of topCats()) {
        rows.push(catRow(top));
        for (const k of subCats(top.id)) rows.push(catRow(k));
        const subIn = el('input', { type: 'text', placeholder: `Add a subcategory to ${top.name}`, maxlength: '40', class: 'sub-add' });
        subIn.addEventListener('keydown', async e => {
          if (e.key !== 'Enter' || !subIn.value.trim()) return;
          e.preventDefault();
          const cat = newCategory(subIn.value, top.id);
          if (cat && !state.categories.some(c => c.id === cat.id)) await saveCategories([...state.categories, cat]);
          draw();
        });
        rows.push(el('div', { class: 'cat-row sub add' }, el('span'), subIn));
      }
      list.replaceChildren(...rows);
      if (!state.categories.length) list.append(el('p', {}, 'No categories yet.'));
    };
    const add = el('input', { type: 'text', placeholder: 'New category', maxlength: '80' });
    const addIt = async () => { if (await createCategoryFromText(add.value)) { add.value = ''; draw(); add.focus(); } };
    add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addIt(); } });
    draw();
    f.classList.add('wide');
    f.append(el('h2', {}, 'Categories'),
      el('p', {}, 'Each entry can have one category or subcategory, like a section of a notebook. Choosing a category also shows the entries in its subcategories. Click a colour to change it.'),
      list,
      el('div', { class: 'cat-add' }, add, el('button', { type: 'button', class: 'btn-plain', onclick: addIt }, 'Add category')),
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


/* ---------- daily quote ---------- */
const strHash = str => { let h = 2166136261; for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const dayNumber = iso => Math.round(dateOf(iso).getTime() / 864e5);
/** [[theme, count], ...] most used first. */
const quoteThemes = () => {
  const m = new Map();
  for (const q of state.quotes) for (const t of q.themes || []) m.set(t, (m.get(t) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};
const STOPWORDS = new Set(('the a an and or of to in is it its that this for on with as be are was were by at from your you yours my our we us me his her their they them not but if so what who when where how all any into than then there these those more most much can will would should may might do does did have has had been being one each other some such no nor only own same too very just also about over out up down off again once here why which while whom upon unto thee thou thy shall let every even still yet ever never always often perhaps').split(' '));
const wordsOf = t => (String(t).toLowerCase().match(/[a-z’']+/g) || []).map(w => w.replace(/[’']s?$/, '')).filter(w => w.length > 2 && !STOPWORDS.has(w));
const stemOf = w => w.replace(/(ings?|ness|ful|ly|ed|es|s)$/, '').slice(0, 7);

/** Themes that fit a quote, judged by the words in quotes already given each theme. */
function suggestThemes(text, exclude = []) {
  const themes = quoteThemes();
  if (!themes.length) return [];
  const mine = new Set(wordsOf(text).map(stemOf));
  if (!mine.size) return [];
  const df = new Map(), bags = new Map();
  for (const [th] of themes) {
    const bag = new Map();
    for (const q of state.quotes) if ((q.themes || []).includes(th)) for (const w of new Set(wordsOf(q.text).map(stemOf))) bag.set(w, (bag.get(w) || 0) + 1);
    bags.set(th, bag);
    for (const w of bag.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  return themes.map(([th, n]) => {
    const bag = bags.get(th);
    let score = 0;
    for (const w of mine) if (bag.has(w)) score += (bag.get(w) / n) * Math.log(1 + themes.length / df.get(w));
    for (const w of wordsOf(th).map(stemOf)) if (mine.has(w)) score += 1;   // the theme's own name appears
    return [th, score];
  }).filter(([th, sc]) => sc >= 0.5 && !exclude.includes(th)).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
}

/** A comma-separated themes box with clickable suggestions underneath. */
/** The two reading packs: built-in writing (on/off) and your readings file (choose / stop). */
function readingsControls() {
  const box = el('div', { class: 'readings-box' });
  const draw = () => {
    const b = el('input', { type: 'checkbox', id: 'builtinReadings' }); b.checked = state.settings.builtinReadings !== false;
    b.addEventListener('change', async () => { await updateSetting({ builtinReadings: b.checked }); await syncReadings(); manageQuotes(); refreshQuote(); });
    const f = readings.file;
    box.replaceChildren(
      el('div', { class: 'row' }, el('div', {}, readings.builtin ? readings.builtin.name : 'Built-in readings',
        el('small', {}, `${readings.builtin ? readings.builtin.count : ''} pieces that come with WellWrite. They become each week’s Reflection, and updates arrive with the app.`)), b),
      el('div', { class: 'row' },
        el('div', {}, 'Your readings file',
          el('small', {}, !f ? 'Choose a text file of quotes once; WellWrite keeps your collection in step with it whenever it changes. Replacing the file replaces its readings — nothing doubles up.'
            : f.missing ? `Can’t find ${f.name} — it may have been moved. Choose it again.` : `${f.name}: ${f.count} readings, kept up to date.`)),
        el('div', { class: 'readings-btns' },
          el('button', { type: 'button', class: 'btn-plain', id: 'pickReadings', onclick: async () => {
            const p = await api.pickReadingsFile(); if (!p) return;
            const n = await syncReadings(); toast(`Readings loaded${n ? ` (${n} changes)` : ''}`); manageQuotes(); refreshQuote();
          } }, f ? 'Change…' : 'Choose…'),
          f ? el('button', { type: 'button', class: 'btn-link danger', onclick: async () => {
            await api.forgetReadingsFile(); await api.syncReadings('file', []); state.quotes = await api.getQuotes(); readings.file = null;
            toast('Stopped using the readings file'); manageQuotes(); refreshQuote();
          } }, 'Stop using') : null)));
  };
  draw();
  return box;
}

/** Title, kind and "my own writing" for a piece in the collection. */
function kindFields(x = {}) {
  const title = el('input', { type: 'text', value: x.title || '', placeholder: 'Title (optional)' });
  const kind = el('select', { 'aria-label': 'What kind of piece' }, el('option', { value: '' }, 'Quote'),
    ...Object.entries(KIND_NAMES).map(([k, n]) => el('option', { value: k }, n)));
  kind.value = x.kind || '';
  const mine = el('input', { type: 'checkbox' }); mine.checked = !!x.mine;
  return {
    el: el('div', { class: 'q-kind-row' }, kind, title, el('label', { class: 'q-mine' }, mine, ' My own writing')),
    get: () => ({ kind: kind.value, title: title.value.trim(), mine: mine.checked }),
    reset: () => { kind.value = ''; title.value = ''; mine.checked = false; },
  };
}

function themesField(initial, getText) {
  const input = el('input', { type: 'text', value: (initial || []).join(', '), placeholder: 'Themes, e.g. Hope, True self', list: 'quoteThemeList', class: 'themes-in' });
  const sugg = el('div', { class: 'theme-sugg' });
  const current = () => input.value.split(',').map(x => x.trim()).filter(Boolean);
  const refresh = () => {
    const have = current().map(x => x.toLowerCase());
    const list = suggestThemes(getText(), []).filter(t => !have.includes(t.toLowerCase()));
    sugg.replaceChildren(...(list.length ? [el('span', {}, 'Suggested: '), ...list.map(t => el('button', { type: 'button', class: 'theme-chip add', onclick: () => {
      input.value = [...current(), t].join(', '); refresh();
    } }, '+ ' + t))] : []));
  };
  input.addEventListener('input', refresh);
  return { el: el('div', { class: 'themes-field' }, input, sugg), get: current, refresh };
}

const quoteAuthors = () => [...new Set(state.quotes.map(q => q.author).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function quotePool() {
  const from = state.settings.quoteFrom || '';
  let pool = state.quotes;
  if (from === 'fav') pool = pool.filter(q => q.fav);
  else if (from.startsWith('author:')) pool = pool.filter(q => q.author === from.slice(7));
  else if (from.startsWith('theme:')) pool = pool.filter(q => (q.themes || []).includes(from.slice(6)));
  return pool.length ? pool : state.quotes;
}

/* --- reading packs: built-in writing, and your readings file, kept up to date --- */
const readings = { file: null, builtin: null };
/** Built-in psalms and reflections count as "your" writing for the weekly Reflection, prayers and blessings. */
const ownish = q => q.mine || q.pack === 'wellwrite';
async function syncReadings({ quiet = true } = {}) {
  let changed = 0;
  try {
    const b = await api.builtinReadings();
    readings.builtin = { name: b.name, count: b.items.length };
    const r = await api.syncReadings('wellwrite', state.settings.builtinReadings === false ? [] : b.items, b.retired);
    state.quotes = r.quotes; changed += r.added + r.updated + r.removed;
  } catch (e) { console.warn('Built-in readings:', e.message); }
  try {
    const f = await api.readReadingsFile();
    readings.file = f ? { name: f.name, path: f.path, missing: !!f.missing, modified: f.modified } : null;
    if (f && f.text != null) {
      const items = parsePastedQuotes(f.text);
      readings.file.count = items.length;
      const r = await api.syncReadings('file', items);
      state.quotes = r.quotes;
      changed += r.added + r.updated + r.removed;
      if (!quiet && changed) toast(`Readings updated: ${r.added} new, ${r.updated} changed, ${r.removed} removed`);
    }
  } catch (e) { toast('Couldn’t read your readings file: ' + e.message); }
  return changed;
}
api.onReadingsChanged(async () => {
  if (!state.unlocked) return;
  await syncReadings({ quiet: false });
  refreshQuote();
  if ($('#dlg').open && $('#dlg .q-summary')) manageQuotes();
});

/* --- the year of themes --- */
/** Prayers and blessings of your own have their own places on the weekly page, so they aren't daily readings. */
const isReading = q => q.kind !== 'prayer' && q.kind !== 'blessing' && !(ownish(q) && (q.kind === 'psalm' || q.text.length > 600));  // your psalms and longer pieces are the week's Reflection
const quotePlan = () => state.settings.quotePlan || 'christian';
/** The season for a date under the chosen plan (null when the plan is off). */
function seasonOn(iso) {
  const plan = quotePlan();
  if (plan === 'off' || !window.WellWriteSeasons) return null;
  return window.WellWriteSeasons.seasonOn(iso, plan);
}
/** Quotes that suit a season, best first: themes listed earlier in the season count for more. */
function seasonPool(season) {
  const n = season.themes.length;
  return state.quotes.map(q => {
    let score = 0;
    (q.themes || []).forEach(t => { const i = season.themes.indexOf(t); if (i >= 0) score += n - i; });
    return { q, score };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || strHash(a.q.id + season.id) - strHash(b.q.id + season.id))
    .map(x => x.q);
}
/** Today's writing question for a season. */
function promptFor(iso) {
  const s = seasonOn(iso);
  if (!s) return '';
  return s.prompts[(s.dayIndex + (state.promptSkip[iso] || 0)) % s.prompts.length];
}

/** The quote for a day. Following a season: the season's best-fitting quotes in order, then round again.
 *  Otherwise: the whole collection (or the chosen part of it) in a shuffled order before repeating. */
function quoteFor(iso) {
  const season = seasonOn(iso);
  if (season) {
    const pool = seasonPool(season).filter(isReading);
    if (pool.length >= 3) return pool[(season.dayIndex + (state.quoteSkip[iso] || 0)) % pool.length];
  }
  const pool = [...quotePool()].sort((a, b) => strHash(a.id) - strHash(b.id));
  if (!pool.length) return null;
  const n = dayNumber(iso) + (state.quoteSkip[iso] || 0);
  return pool[((n % pool.length) + pool.length) % pool.length];
}

const hiddenQuoteDays = (() => { try { return new Set(JSON.parse(localStorage.getItem('quoteHidden') || '[]')); } catch { return new Set(); } })();
function hideQuoteFor(iso) {
  hiddenQuoteDays.add(iso);
  try { localStorage.setItem('quoteHidden', JSON.stringify([...hiddenQuoteDays].slice(-60))); } catch {}
}

function quoteCard(iso, where) {
  if (hiddenQuoteDays.has(iso)) return null;
  const q = quoteFor(iso);
  if (!q) return null;
  const btn = (label, fn, cls = 'q-btn') => el('button', { type: 'button', class: cls, onclick: fn }, label);
  const star = el('button', { type: 'button', class: 'q-star' + (q.fav ? ' on' : ''), title: q.fav ? 'Remove from favourites' : 'Add to favourites', 'aria-pressed': String(q.fav),
    onclick: async () => { await saveQuotes(state.quotes.map(x => (x.id === q.id ? { ...x, fav: !x.fav } : x))); refreshQuote(); } }, q.fav ? '★' : '☆');
  const season = seasonOn(iso), prompt = promptFor(iso);
  return el('figure', { class: 'quote-card ' + where },
    season ? el('p', { class: 'q-season' }, `${season.name}, day ${season.dayIndex + 1}`) : null,
    el('blockquote', {}, q.text),
    el('figcaption', {}, '— ' + (q.author || 'Unknown') + (q.source ? ', ' : ''), q.source ? el('cite', {}, q.source) : null),
    prompt ? el('p', { class: 'q-prompt' }, prompt) : null,
    el('div', { class: 'q-actions' },
      btn('Write about this', () => writeAboutQuote(q, iso, prompt), 'q-btn primary'),
      state.quotes.length > 1 ? btn('Another', () => { state.quoteSkip[iso] = (state.quoteSkip[iso] || 0) + 1; refreshQuote(); }) : null,
      star,
      btn('Your quotes', () => manageQuotes()),
      btn('Hide today', () => { hideQuoteFor(iso); refreshQuote(); }, 'q-btn subtle')));
}

/* What shows above the journal: the quote, the verse of the day, both, or nothing. */
const dailyChoice = () => (state.settings.showQuote === false && state.settings.dailyCard === 'quote' ? 'none' : state.settings.dailyCard || 'quote');

async function getVerse(iso) {
  const tr = (state.bible && state.bible.state.translation) || 'web';
  const key = iso + tr;
  if (!(key in state.verseCache)) {
    try { state.verseCache[key] = await api.verseOfDay(dayNumber(iso), tr); } catch { state.verseCache[key] = null; }
  }
  return state.verseCache[key];
}

function verseCard(v, iso, where) {
  if (!v || hiddenQuoteDays.has('v' + iso)) return null;
  const btn = (label, fn, cls = 'q-btn') => el('button', { type: 'button', class: cls, onclick: fn }, label);
  return el('figure', { class: 'quote-card verse ' + where },
    el('blockquote', {}, v.text),
    el('figcaption', {}, '— ' + v.ref + ' ', el('cite', {}, v.translation)),
    el('div', { class: 'q-actions' },
      btn('Write about this', () => writeAboutQuote({ text: v.text, author: v.ref, source: v.translation }, iso), 'q-btn primary'),
      btn(state.bible && state.bible.state.plan ? 'Today’s reading' : 'Reading plans', () => setMode('bible')),
      btn('Hide today', () => { hideQuoteFor('v' + iso); refreshQuote(); }, 'q-btn subtle')));
}

let dailyToken = 0;
/** Fill a container with the cards chosen to appear above the journal. */
async function fillDaily(box, iso, where) {
  if (!box) return;
  const token = ++dailyToken;
  const choice = dailyChoice();
  const cards = [];
  if (choice === 'quote' || choice === 'both') cards.push(quoteCard(iso, where));
  if (choice === 'verse' || choice === 'both') cards.push(verseCard(await getVerse(iso), iso, where));
  if (token !== dailyToken) return; // a newer render started meanwhile
  const shown = cards.filter(Boolean);
  box.replaceChildren(...shown);
  box.hidden = !shown.length;
}

function renderQuoteSlot() {
  const slot = $('#quoteSlot');
  const c = state.current;
  if (!c || c.date !== todayISO()) { slot.hidden = true; slot.replaceChildren(); return; }
  // Once you've written about today's quote or verse, don't keep showing it.
  const used = [...body.querySelectorAll('blockquote')].map(b => b.textContent).join('\n');
  const q = quoteFor(c.date);
  if (q && used.includes(q.text.split('\n')[0].slice(0, 40))) hideQuoteFor(c.date);
  const v = state.verseCache[c.date + ((state.bible && state.bible.state.translation) || 'web')];
  if (v && used.includes(v.text.split('\n')[0].slice(0, 30))) hideQuoteFor('v' + c.date);
  fillDaily(slot, c.date, 'in-sheet');
}

function refreshQuote() {
  if (state.mode === 'quote') renderQuoteView();
  else if (state.mode === 'bible') renderBibleView();
  else if (state.current) renderQuoteSlot();
  else if (!$('#empty').hidden) showEmpty();
}

async function writeAboutQuote(q, iso, prompt = '') {
  if (state.mode !== 'journal') setMode('journal');
  if (!state.current || state.current.date !== iso) {
    const existing = sorted(state.metas.filter(m => m.date === iso))[0];
    if (existing) await openEntry(existing.id); else await newEntry(iso);
  }
  const quote = el('blockquote', {}, ...q.text.split('\n').flatMap((line, i) => (i ? [el('br'), line] : [line])),
    el('br'), '— ' + (q.author || 'Unknown') + (q.source ? `, ${q.source}` : ''));
  const after = el('p', {}, el('br'));
  body.prepend(...[quote, prompt ? el('p', {}, el('i', {}, prompt)) : null, after].filter(Boolean));
  body.focus();
  const r = document.createRange(); r.setStart(after, 0); r.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  markDirty(); updateCounts(); renderQuoteSlot();
}

async function saveQuotes(list) {
  try { state.quotes = await api.setQuotes(list); } catch (x) { toast(x.message); }
}

/* --- reading quotes from pasted text or a Kindle clippings file --- */
/**
 * Quotes from pasted text or a text file. Understands:
 *  - quotes ending with a "— Writer, Book" line (the quote can run over several paragraphs)
 *  - Goodreads quote pages copied straight from the browser (likes, tags and buttons are skipped)
 *  - "Themes: Hope, Soul", "Title: Psalm One" and "Kind: Psalm, my own writing" after a quote
 *  - otherwise, one quote per blank-line-separated block, using the default writer and book
 */
const ATTR_LINE = /^[—―–]{1,2}\s*(\S.*)$|^-{1,2}\s+(\S.*)$/;
const JUNK_LINE = [/^showing \d+-\d+ of [\d,]+/i, /> quotes\s*$/i, /^\(\?\)$/, /^like$/i, /^[\d,]+ likes?$/i, /^tags:/i];
const isJunk = l => JUNK_LINE.some(r => r.test(l));
const themesLine = l => { const m = l.match(/^themes?:\s*(.*)$/i); return m ? m[1].split(',').map(t => t.trim()).filter(Boolean) : null; };
const KIND_NAMES = { poem: 'Poem', psalm: 'Psalm', prayer: 'Prayer', blessing: 'Blessing', reflection: 'Reflection', fieldnote: 'Field note' };
/** "Title: …" or "Kind: Psalm, my own writing" lines that can follow a quote. */
const metaLine = l => {
  let m = l.match(/^title:\s*(.+)$/i);
  if (m) return { title: m[1].trim() };
  m = l.match(/^kind:\s*(.+)$/i);
  if (!m) return null;
  const parts = m[1].toLowerCase().split(',').map(x => x.trim());
  const kind = Object.keys(KIND_NAMES).find(k => parts.some(p => p === k || p === KIND_NAMES[k].toLowerCase())) || '';
  return { kind, mine: parts.some(p => /^(mine|my own( writing)?|by me)$/.test(p)) };
};
/** Reads the Themes / Title / Kind lines after a quote into one object; null if the line is none of them. */
const quoteMeta = (l, meta) => {
  const th = themesLine(l);
  if (th) { meta.themes = th; return true; }
  const m = metaLine(l);
  if (m) { Object.assign(meta, m); return true; }
  return false;
};
/** "Some words — Writer, Book" on one line. The part after the dash must look like a name, not more sentence. */
const inlineAttribution = line => {
  const m = line.match(/^(.*\S)\s+[—―–]\s+([^—―–]+)$/) || line.match(/^(.*\S)\s+-\s+([^-]+)$/);
  if (!m) return null;
  const who = m[2].trim();
  if (who.length > 90 || /[.!?;]$/.test(who) || who.split(',')[0].trim().split(/\s+/).length > 5) return null;
  return [m[1], who];
};
/** Remove quote marks wrapped round the whole text, but not ones that belong to a word inside it ("“Hope” is the thing…"). */
const stripQuoteMarks = t => {
  t = t.trim();
  const m = t.match(/^[“"]+([\s\S]*?)[”"]+$/);
  if (m && !/[“”"]/.test(m[1])) return m[1].trim();
  if (/^[“"]/.test(t) && !/[”"]/.test(t.slice(1))) return t.replace(/^[“"]+/, '').trim();   // opened, never closed
  if (/[”"]$/.test(t) && !/[“"]/.test(t.slice(0, -1))) return t.replace(/[”"]+$/, '').trim(); // closed, never opened
  return t;
};

function parsePastedQuotes(text, defAuthor = '', defSource = '') {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
    .replace(/\[([^\]]*)\]\((?:https?:|mailto:)[^)]*\)/g, '$1')   // Markdown links: keep the words
    .replace(/^[ \t]*[*•][ \t]+/gm, '')                          // bullet points
    .split('\n');
  const out = [];
  const push = (textLines, author, source, meta = {}) => {
    const t = stripQuoteMarks(textLines.join('\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim());
    // Long "Title: Subtitle" book names (as Goodreads gives them) keep just the title, without "Revised edition".
    if (source && source.length > 40 && /^[^,“”]{3,}:\s/.test(source)) source = source.slice(0, source.indexOf(':')).trim();
    if (source) source = source.replace(/\s*[-–(]\s*(revised|new|expanded|updated|anniversary)[^)]*\)?$/i, '').trim();
    if (t) out.push({ text: trimCutShort(t), author: author || defAuthor, source, themes: meta.themes || [],
      ...(meta.kind ? { kind: meta.kind } : {}), ...(meta.title ? { title: meta.title } : {}), ...(meta.mine ? { mine: true } : {}) });
  };
  // Blocks with no writer line: one quote per block (an inline "text — Writer" works too).
  const pushBlocks = blockLines => {
    for (const block of blockLines.join('\n').split(/\n\s*\n/)) {
      const ls = block.split('\n').map(l => l.trim()).filter(l => l && !isJunk(l));
      if (!ls.length) continue;
      const meta = {};
      while (ls.length > 1 && quoteMeta(ls[ls.length - 1], meta)) ls.pop();
      const m = ls.length === 1 && inlineAttribution(ls[0]);
      if (m) { const [author, source = ''] = splitAttribution(m[1]); push([m[0]], author, source, meta); }
      else push(ls, defAuthor, defSource, meta);
    }
  };

  let buf = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = l.match(ATTR_LINE);
    // Two or more dash lines in a row are a list inside a poem ("– Pride; / – Arrogance;"), not a writer.
    const near = d => { for (let k = i + d; k >= 0 && k < lines.length; k += d) { const t = lines[k].trim(); if (t) return t; if (d > 0) return ''; } return ''; };
    const inList = m && (ATTR_LINE.test(near(1)) || ATTR_LINE.test(near(-1)));
    if (m && !inList && buf.some(x => x.trim() && !isJunk(x.trim()))) {
      let [author, source = ''] = splitAttribution(m[1] || m[2]);
      let j = i + 1;
      const meta = {};
      // Goodreads puts the book on its own line after a lone comma.
      while (j < lines.length && !lines[j].trim()) j++;
      if (!source && lines[j] && lines[j].trim() === ',' && lines[j + 1] && lines[j + 1].trim()) { source = lines[j + 1].trim(); j += 2; }
      for (; j < lines.length; j++) {
        const t = lines[j].trim();
        if (!t || isJunk(t)) continue;
        if (quoteMeta(t, meta)) continue;
        break;
      }
      // Any complete one-line "text — Writer" quotes before this one stand on their own.
      const blocks = buf.join('\n').split(/\n\s*\n/);
      while (blocks.length > 1 && !blocks[0].trim().includes('\n') && inlineAttribution(blocks[0].trim())) pushBlocks([blocks.shift()]);
      push(blocks.join('\n\n').split('\n').filter(x => !isJunk(x.trim())), author, source, meta);
      buf = []; i = j - 1;
      continue;
    }
    buf.push(lines[i]);
  }
  pushBlocks(buf);
  return sameWriterNames(out);
}

/** Goodreads cuts long quotes off mid-word ("…on a jo..."): go back to the last full sentence or line, and mark it. */
function trimCutShort(t) {
  if (!/[A-Za-z’',;)]\.\.\.$/.test(t) && !/\s\.\.\.$/.test(t)) return t;
  const body = t.replace(/\s*\.\.\.$/, '');
  const ends = [...body.matchAll(/[.!?;:](?=["”’)]?\s)|\n/g)].map(m => m.index + (m[0] === '\n' ? 0 : 1));
  const cut = ends.length ? ends[ends.length - 1] : -1;
  if (cut < body.length * 0.4) return body.replace(/\s*\S*$/, '') + ' …'; // nothing sensible to go back to: drop the broken word
  return body.slice(0, cut).trim() + ' …';
}

/** "Parker Palmer" and "Parker J. Palmer" are the same writer: use the fuller name (or the one already in your collection). */
function sameWriterNames(list) {
  const keyOf = a => {
    const w = a.toLowerCase().replace(/[.’']/g, '').replace(/^(st|saint)\s+/, '').replace(/\s+of\s+\S+$/, '').split(/\s+/).filter(Boolean);
    return w.length > 1 ? w[0] + ' ' + w[w.length - 1] : w.join(' ');
  };
  const best = new Map();
  for (const a of [...state.quotes.map(q => q.author), ...list.map(q => q.author)]) {
    if (!a) continue;
    const k = keyOf(a), cur = best.get(k);
    const caps = x => (x.match(/[A-Z]/g) || []).length;
    if (!cur || (!state.quotes.some(q => q.author === cur) && (a.length > cur.length || (a.length === cur.length && caps(a) > caps(cur))))) best.set(k, a);
  }
  return list.map(q => (q.author ? { ...q, author: best.get(keyOf(q.author)) || q.author } : q));
}
function splitAttribution(s) {
  let depth = 0, i = -1;
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '(') depth++; else if (s[k] === ')') depth--; else if (s[k] === ',' && depth <= 0) { i = k; break; }
  }
  if (i < 0) return [s.trim(), ''];
  let src = s.slice(i + 1).trim();
  if (/^["“][^"“”]*["”]$/.test(src)) src = src.slice(1, -1); // a source that is only a quoted title
  src = src.replace(/\s*\([^()]*#\d+(\.\d+)?\)\s*$/, '');      // Goodreads series label
  return [s.slice(0, i).trim(), src];
}

/** Kindle "My Clippings.txt": highlights only (not bookmarks or your own notes). */
function parseKindle(text) {
  const out = [], seen = new Set();
  for (const chunk of text.split(/\r?\n==========\r?\n?/)) {
    const lines = chunk.replace(/^﻿/, '').split(/\r?\n/);
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length < 3 || !/highlight/i.test(lines[1])) continue;
    const head = lines[0].trim();
    const m = head.match(/^(.*)\(([^()]*)\)\s*$/);
    let book = (m ? m[1] : head).trim(), author = m ? m[2].trim() : '';
    // Kindle often writes "O'Donohue, John": turn it round.
    const parts = author.split(',').map(x => x.trim());
    if (parts.length === 2 && parts[1] && !/\s/.test(parts[0]) && !/\s/.test(parts[1])) author = `${parts[1]} ${parts[0]}`;
    author = author.replace(/;/g, ', ');
    const body = lines.slice(2).join('\n').trim();
    if (!body) continue;
    const key = (body + author).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text: body, author, source: book });
  }
  // Kindle keeps both a short and a longer version when you extend a highlight; keep the longer.
  return out.filter(q => !out.some(o => o !== q && o.source === q.source && o.text.length > q.text.length && o.text.includes(q.text)));
}

function importPreview(found, fromLabel) {
  return openDialog((f, done) => {
    const groups = new Map();
    for (const q of found) {
      const book = (q.source || '').split(/,\s*“/)[0].trim(); // "To Bless…, “For Longing”" is from To Bless…
      const k = `${book}|${q.author}`;
      if (!groups.has(k)) groups.set(k, { book, author: q.author, items: [] });
      groups.get(k).items.push(q);
    }
    const existing = new Set(state.quotes.map(q => (q.text + '|' + q.author).toLowerCase().replace(/\s+/g, ' ')));
    const fresh = q => !existing.has((q.text + '|' + q.author).toLowerCase().replace(/\s+/g, ' '));
    const boxes = [];
    const list = el('div', { class: 'imp-list' }, ...[...groups.values()].sort((a, b) => (a.author || '').localeCompare(b.author || '') || (!a.book) - (!b.book) || (a.book || '').localeCompare(b.book || '')).map(g => {
      const n = g.items.filter(fresh).length;
      const themed = g.items.some(q => !fresh(q) && ((q.themes || []).length || q.kind || q.title || q.mine));
      const cb = el('input', { type: 'checkbox' }); cb.checked = n > 0 || themed; cb.disabled = !n && !themed;
      boxes.push([cb, g]);
      return el('label', { class: 'imp-row' }, cb,
        el('span', {}, g.book ? el('b', {}, g.book) : el('b', {}, g.author ? `Other quotes by ${g.author}` : 'Quotes with no writer'), g.book && g.author ? ` — ${g.author}` : ''),
        el('small', {}, n ? `${n} new` : themed ? 'themes only' : 'already added'));
    }));
    const go = el('button', { type: 'submit', class: 'btn-ink' }, 'Import');
    const count = () => {
      const picked = boxes.filter(([c]) => c.checked);
      const n = picked.reduce((a, [, g]) => a + g.items.filter(fresh).length, 0);
      go.textContent = n ? `Import ${n} quote${n === 1 ? '' : 's'}` : 'Update themes';
      go.disabled = !picked.length;
    };
    list.addEventListener('change', count);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const chosen = boxes.filter(([c]) => c.checked).flatMap(([, g]) => g.items);
      const add = chosen.filter(fresh);
      // Quotes you already have keep their place but pick up any new themes.
      const keyOf = q => (q.text + '|' + q.author).toLowerCase().replace(/\s+/g, ' ');
      const extra = new Map(chosen.filter(q => !fresh(q)).map(q => [keyOf(q), q]));
      let updated = 0;
      const merged = state.quotes.map(q => {
        const x = extra.get(keyOf(q));
        if (!x) return q;
        const themes = [...new Set([...(q.themes || []), ...(x.themes || [])])];
        const next = { ...q, themes, kind: q.kind || x.kind || '', title: q.title || x.title || '', mine: q.mine || !!x.mine };
        if (themes.length !== (q.themes || []).length || next.kind !== (q.kind || '') || next.title !== (q.title || '') || next.mine !== !!q.mine) updated++;
        return next;
      });
      await saveQuotes([...merged, ...add]);
      done();
      toast(`Added ${add.length} quote${add.length === 1 ? '' : 's'}` + (updated ? `, updated themes on ${updated}` : ''));
      refreshQuote(); manageQuotes();
    });
    f.classList.add('wide');
    f.append(el('h2', {}, `Import from ${fromLabel}`),
      el('p', {}, `Found ${found.length} quote${found.length === 1 ? '' : 's'}. Untick any books you don’t want.`),
      list,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); manageQuotes(); } }, 'Cancel'), go));
    count();
  });
}

function pasteQuotes() {
  return openDialog((f, done) => {
    const ta = el('textarea', { rows: '10', placeholder: 'Paste quotes here, with a blank line between each.\n\nTo say who wrote one, finish it with a line like:\n— John O’Donohue, Anam Cara', autofocus: true });
    const who = el('input', { type: 'text', placeholder: 'e.g. Parker J. Palmer' });
    const book = el('input', { type: 'text', placeholder: 'e.g. Let Your Life Speak' });
    f.addEventListener('submit', e => {
      e.preventDefault();
      const found = parsePastedQuotes(ta.value, who.value.trim(), book.value.trim());
      if (!found.length) { toast('Nothing to import yet. Paste some quotes first.'); return; }
      done(); importPreview(found, 'pasted text');
    });
    f.classList.add('wide');
    f.append(el('h2', {}, 'Paste several quotes'),
      el('p', {}, 'Paste from your notes, an ebook, or a Goodreads quotes page. End each quote with a line like “— Parker J. Palmer, Let Your Life Speak”, and add “Themes: Vocation, True self” if you like.'),
      ta,
      el('div', { class: 'q-two' },
        el('label', { class: 'field' }, 'Writer, if not given', who),
        el('label', { class: 'field' }, 'Book, if not given', book)),
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); manageQuotes(); } }, 'Cancel'), el('button', { type: 'submit', class: 'btn-ink' }, 'Next')));
  });
}

async function importQuotesFile() {
  let file;
  try { file = await api.pickQuotesFile(); } catch (x) { toast(x.message); return; }
  if (!file) return manageQuotes();
  const kindle = /^==========\s*$/m.test(file.text) && /Your Highlight/i.test(file.text);
  const found = kindle ? parseKindle(file.text) : parsePastedQuotes(file.text);
  if (!found.length) { toast(kindle ? 'No highlights found in that file.' : 'No quotes found in that file.'); return manageQuotes(); }
  importPreview(found, kindle ? 'Kindle highlights' : file.name);
}

let quoteThemeFilter = '';
function manageQuotes() {
  return openDialog((f, done) => {
    const s = state.settings;
    const find = el('input', { type: 'search', placeholder: 'Search your quotes, writers or themes', 'aria-label': 'Search quotes' });
    const themeBar = el('div', { class: 'theme-bar' });
    const list = el('div', { class: 'q-list' });
    const summary = el('p', { class: 'q-summary' });
    const fromOptions = () => [
      el('option', { value: '' }, 'All my quotes'), el('option', { value: 'fav' }, 'Favourites only'),
      ...(quoteThemes().length ? [el('optgroup', { label: 'A theme' }, ...quoteThemes().map(([t]) => el('option', { value: 'theme:' + t }, t)))] : []),
      el('optgroup', { label: 'A writer' }, ...quoteAuthors().map(a => el('option', { value: 'author:' + a }, a))),
    ];
    const from = el('select', { 'aria-label': 'Choose the daily quote from',
      onchange: async e => { await updateSetting({ quoteFrom: e.target.value }); refreshQuote(); } }, ...fromOptions());
    from.value = s.quoteFrom || '';
    const show = el('input', { type: 'checkbox', onchange: async e => {
      const c = dailyChoice();
      const next = e.target.checked ? (c === 'verse' ? 'both' : c === 'none' ? 'quote' : c) : (c === 'both' ? 'verse' : c === 'quote' ? 'none' : c);
      await updateSetting({ dailyCard: next, showQuote: true }); refreshQuote();
    } });
    show.checked = ['quote', 'both'].includes(dailyChoice());
    const themeList = el('datalist', { id: 'quoteThemeList' });
    const planSel = el('select', { 'aria-label': 'What the daily quote follows', onchange: async e => {
      await updateSetting({ quotePlan: e.target.value }); fromRowShow(); refreshQuote();
    } }, el('option', { value: 'christian' }, 'The Christian year'), el('option', { value: 'spiritual' }, 'A spiritual theme each month'), el('option', { value: 'off' }, 'My own choice'));
    planSel.value = quotePlan();
    const fromRowShow = () => { const r = document.getElementById('fromRow'); if (r) r.hidden = quotePlan() !== 'off'; };
    setTimeout(fromRowShow);

    const draw = () => {
      const themes = quoteThemes();
      if (quoteThemeFilter && !quoteThemeFilter.startsWith('\u0000') && !themes.some(([t]) => t === quoteThemeFilter)) quoteThemeFilter = '';
      themeList.replaceChildren(...themes.map(([t]) => el('option', { value: t })));
      themeBar.replaceChildren(...(themes.length ? [
        el('button', { type: 'button', class: 'theme-chip' + (!quoteThemeFilter ? ' on' : ''), onclick: () => { quoteThemeFilter = ''; draw(); } }, 'All'),
        ...themes.map(([t, n]) => el('button', { type: 'button', class: 'theme-chip' + (quoteThemeFilter === t ? ' on' : ''),
          onclick: () => { quoteThemeFilter = quoteThemeFilter === t ? '' : t; draw(); } }, t, el('small', {}, String(n)))),
        ...[['wellwrite', 'Built-in writing'], ['file', 'From your readings file']].map(([id, label]) => state.quotes.some(q => q.pack === id)
          ? el('button', { type: 'button', class: 'theme-chip mine' + (quoteThemeFilter === '\u0000pack:' + id ? ' on' : ''), onclick: () => { quoteThemeFilter = quoteThemeFilter === '\u0000pack:' + id ? '' : '\u0000pack:' + id; draw(); } },
            label, el('small', {}, String(state.quotes.filter(q => q.pack === id).length))) : null),
        state.quotes.some(q => q.mine)
          ? el('button', { type: 'button', class: 'theme-chip mine' + (quoteThemeFilter === '\u0000mine' ? ' on' : ''), onclick: () => { quoteThemeFilter = quoteThemeFilter === '\u0000mine' ? '' : '\u0000mine'; draw(); } },
            'My own writing', el('small', {}, String(state.quotes.filter(q => q.mine).length))) : null,
        state.quotes.some(q => !(q.themes || []).length)
          ? el('button', { type: 'button', class: 'theme-chip' + (quoteThemeFilter === '\u0000none' ? ' on' : ''), onclick: () => { quoteThemeFilter = quoteThemeFilter === '\u0000none' ? '' : '\u0000none'; draw(); } },
            'No theme yet', el('small', {}, String(state.quotes.filter(q => !(q.themes || []).length).length))) : null,
      ].filter(Boolean) : []));
      const q = find.value.trim().toLowerCase();
      const items = state.quotes
        .filter(x => !quoteThemeFilter || (quoteThemeFilter === '\u0000none' ? !(x.themes || []).length : quoteThemeFilter === '\u0000mine' ? x.mine : quoteThemeFilter.startsWith('\u0000pack:') ? x.pack === quoteThemeFilter.slice(6) : (x.themes || []).includes(quoteThemeFilter)))
        .filter(x => !q || (x.text + ' ' + x.author + ' ' + x.source + ' ' + (x.title || '') + ' ' + (x.themes || []).join(' ')).toLowerCase().includes(q))
        .sort((a, b) => Number(b.fav) - Number(a.fav) || (a.author || '').localeCompare(b.author || ''));
      summary.replaceChildren(`${state.quotes.length} quote${state.quotes.length === 1 ? '' : 's'} from ${quoteAuthors().length} writer${quoteAuthors().length === 1 ? '' : 's'}` +
        (themes.length ? `, in ${themes.length} theme${themes.length === 1 ? '' : 's'}` : '') + (items.length !== state.quotes.length ? `. Showing ${items.length}.` : '.'));
      // Clear out everything shown (e.g. all of "My own writing" before importing a new selection). Two clicks, no pop-up.
      if (items.length && items.length !== state.quotes.length) {
        const del = el('button', { type: 'button', class: 'btn-link danger', id: 'deleteShown' }, `Delete these ${items.length}`);
        del.addEventListener('click', async () => {
          if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = `Click again to delete ${items.length}`; return; }
          const gone = new Set(items.map(x => x.id));
          await saveQuotes(state.quotes.filter(x => !gone.has(x.id)));
          toast(`Deleted ${gone.size}`); quoteThemeFilter = ''; find.value = ''; draw(); refreshQuote();
        });
        summary.append(' ', del);
      }
      list.replaceChildren(...items.slice(0, 300).map(x => {
        const row = el('div', { class: 'q-row' });
        const view = () => row.replaceChildren(
          el('button', { type: 'button', class: 'q-star' + (x.fav ? ' on' : ''), title: x.fav ? 'Remove from favourites' : 'Add to favourites',
            onclick: async () => { await saveQuotes(state.quotes.map(y => (y.id === x.id ? { ...y, fav: !y.fav } : y))); x = state.quotes.find(y => y.id === x.id); view(); refreshQuote(); } }, x.fav ? '★' : '☆'),
          el('div', { class: 'q-main' },
            x.title || x.kind || x.mine ? el('p', { class: 'q-kind' }, [x.kind ? KIND_NAMES[x.kind] : '', x.title, x.mine ? 'my own writing' : ''].filter(Boolean).join(' · ')) : null,
            el('p', { class: 'q-text' }, x.text),
            el('small', {}, (x.author || 'Unknown') + (x.source ? `, ${x.source}` : '')),
            (x.themes || []).length ? el('div', { class: 'q-themes' }, ...x.themes.map(t => el('button', { type: 'button', class: 'theme-chip mini', onclick: () => { quoteThemeFilter = t; draw(); } }, t))) : null),
          el('div', { class: 'q-row-btns' },
            el('button', { type: 'button', class: 'btn-link', onclick: edit }, 'Edit'),
            el('button', { type: 'button', class: 'btn-link danger', onclick: async () => { await saveQuotes(state.quotes.filter(y => y.id !== x.id)); draw(); refreshQuote(); } }, 'Delete')));
        const edit = () => {
          const t = el('textarea', { rows: '4' }); t.value = x.text;
          const a = el('input', { type: 'text', value: x.author, placeholder: 'Writer' });
          const b = el('input', { type: 'text', value: x.source, placeholder: 'Book or source' });
          const th = themesField(x.themes, () => t.value);
          const kf = kindFields(x);
          t.addEventListener('input', th.refresh);
          row.replaceChildren(el('div', { class: 'q-edit' }, t, el('div', { class: 'q-two' }, a, b), kf.el, th.el,
            el('div', { class: 'btns' },
              el('button', { type: 'button', class: 'btn-ink', onclick: async () => {
                if (!t.value.trim()) return;
                await saveQuotes(state.quotes.map(y => (y.id === x.id ? { ...y, text: t.value, author: a.value, source: b.value, themes: th.get(), ...kf.get() } : y)));
                x = state.quotes.find(y => y.id === x.id) || x; draw(); refreshQuote();
              } }, 'Save'),
              el('button', { type: 'button', class: 'btn-plain', onclick: view }, 'Cancel'))));
          th.refresh();
          t.focus();
        };
        view();
        return row;
      }));
      if (!items.length) list.append(el('p', { class: 'q-summary' }, q ? `No quotes match “${q}”.` : 'No quotes here yet.'));
      if (items.length > 300) list.append(el('p', { class: 'q-summary' }, `Showing 300 of ${items.length}. Search to narrow them down.`));
    };
    find.addEventListener('input', draw);

    const text = el('textarea', { rows: '3', placeholder: 'Type or paste a quote' });
    const author = el('input', { type: 'text', placeholder: 'Writer, e.g. John O’Donohue', list: 'quoteAuthorList' });
    const source = el('input', { type: 'text', placeholder: 'Book or source (optional)' });
    const themes = themesField([], () => text.value);
    const kinds = kindFields();
    let t0; text.addEventListener('input', () => { clearTimeout(t0); t0 = setTimeout(themes.refresh, 250); });
    const add = async () => {
      if (!text.value.trim()) { text.focus(); return; }
      await saveQuotes([...state.quotes, { text: text.value, author: author.value, source: source.value, themes: themes.get(), ...kinds.get() }]);
      text.value = ''; source.value = ''; kinds.reset(); themes.el.querySelector('input').value = ''; themes.refresh();
      draw(); refreshQuote(); toast('Quote added');
      text.focus();
    };

    f.classList.add('wide');
    f.append(
      el('h2', {}, 'Your quotes'),
      el('p', {}, 'One of these appears at the top of each day. Give quotes themes to keep them organised; favourites (★) come first.'),
      el('div', { class: 'row' }, el('div', {}, 'Show the quote above my journal'), show),
      el('div', { class: 'row' }, el('div', {}, 'Each day’s quote and question follow', el('small', {}, 'The Christian year includes Advent, Christmas, Lent, Holy Week and Easter, with dates worked out each year.')), planSel),
      el('div', { class: 'row', id: 'fromRow' }, el('div', {}, 'Choose each day’s quote from'), from),
      readingsControls(),
      el('h3', {}, 'Add a quote'),
      text,
      el('div', { class: 'q-two' }, author, source),
      kinds.el,
      themes.el,
      el('datalist', { id: 'quoteAuthorList' }, ...quoteAuthors().map(a => el('option', { value: a }))),
      themeList,
      el('div', { class: 'btns', style: 'margin-top:8px' },
        el('button', { type: 'button', class: 'btn-ink', onclick: add }, 'Add quote'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); pasteQuotes(); } }, 'Paste several…'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); importQuotesFile(); } }, 'Import from a file…'),
        el('button', { type: 'button', class: 'btn-link', onclick: exportQuotes }, 'Export')),
      el('h3', {}, 'Your collection'),
      find, themeBar, summary, list,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-ink', onclick: () => done() }, 'Done')));
    draw();
  });
}

/** Quotes as plain text in the same layout the importer reads, so they can be edited or shared and brought back. */
function quotesAsText(list) {
  return list.map(q => [q.text, '— ' + (q.author || 'Unknown') + (q.source ? `, ${q.source}` : ''),
    q.title ? 'Title: ' + q.title : null,
    q.kind || q.mine ? 'Kind: ' + [q.kind ? KIND_NAMES[q.kind] : null, q.mine ? 'my own writing' : null].filter(Boolean).join(', ') : null,
    (q.themes || []).length ? 'Themes: ' + q.themes.join(', ') : null]
    .filter(Boolean).join('\n')).join('\n\n\n') + '\n';
}
async function exportQuotes() {
  try {
    const r = await api.exportQuotes(quotesAsText(state.quotes));
    if (r) toast(`Saved ${state.quotes.length} quotes`);
  } catch (x) { toast(x.message); }
}


/* ---------- views: Journal / Bible / Quote ---------- */
function setMode(mode) {
  if (!['journal', 'bible', 'quote'].includes(mode)) mode = 'journal';
  if (state.mode === 'journal' && mode !== 'journal') saveNow();
  state.mode = mode;
  try { localStorage.setItem('mode', mode); } catch {}
  $('#page').dataset.mode = mode;
  for (const b of document.querySelectorAll('.modeswitch [data-mode]')) {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  }
  $('#showAbove').hidden = mode !== 'journal';
  closePopover();
  if (mode === 'bible') renderBibleView();
  else if (mode === 'quote') renderQuoteView();
  else if (state.current) renderQuoteSlot(); else showEmpty();
  $('#sheetScroll').scrollTop = 0;
}
for (const b of document.querySelectorAll('.modeswitch [data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));

$('#showAbove').addEventListener('click', () => {
  showPopover($('#showAbove').getBoundingClientRect(), pop => {
    pop.classList.add('menu');
    pop.append(el('p', { class: 'pop-hint', style: 'margin:4px 10px 6px' }, 'Show above your journal'));
    for (const [v, label] of [['quote', 'Quote of the day'], ['verse', 'Verse of the day'], ['both', 'Quote and verse'], ['none', 'Nothing, just the journal']]) {
      pop.append(el('button', { type: 'button', class: 'menu-item' + (dailyChoice() === v ? ' on' : ''),
        onclick: async () => { await updateSetting({ dailyCard: v, showQuote: true }); closePopover(); refreshQuote(); } }, label));
    }
  });
});

// --- Bible
const planDays = () => { const b = state.bible; const p = b && b.plans.find(x => x.id === b.state.plan); return p ? p.days : 0; };
const todayPlanDay = () => {
  const st = state.bible.state;
  return Math.floor((dateOf(todayISO()) - dateOf(st.start)) / 864e5 + 0.5);
};

async function saveBible(patch) {
  try {
    const st = await api.setBibleState({ ...state.bible.state, ...patch });
    state.bible.state = st;
  } catch (x) { toast(x.message); }
  state.verseCache = {};
}

function renderPassage(ch) {
  const out = [el('h3', { class: 'chap' }, `${ch.book} ${ch.chapter}`)];
  for (const block of ch.blocks) {
    if (block[0] === 'h') { out.push(el('p', { class: 'b-head' }, block[1])); continue; }
    if (block[0] === 'p') {
      const p = el('p', { class: 'b-para' });
      for (const [v, text] of block[1]) p.append(el('sup', {}, String(v)), text + ' ');
      out.push(p);
    } else {
      const q = el('div', { class: 'b-poem' });
      let last = null;
      for (const [v, text] of block[1]) {
        q.append(el('span', { class: 'b-line' }, v !== last ? el('sup', {}, String(v)) : null, text));
        last = v;
      }
      out.push(q);
    }
  }
  return out;
}

let bibleToken = 0;
async function renderBibleView() {
  const box = $('#bibleView');
  const b = state.bible;
  const token = ++bibleToken;
  if (!b) { box.replaceChildren(el('p', { class: 'rv-note' }, 'The Bible could not be loaded.')); return; }
  const st = b.state;
  const verse = await getVerse(todayISO());

  if (!st.plan || !st.start) {
    // Choose a plan
    let plan = 'year', tr = st.translation || 'web';
    const opts = el('div', { class: 'plan-opts' }, ...b.plans.map(p => {
      const r = el('input', { type: 'radio', name: 'plan', value: p.id }); r.checked = p.id === plan;
      r.addEventListener('change', () => { plan = p.id; });
      return el('label', { class: 'plan-opt' }, r, el('span', {}, el('b', {}, p.name), el('small', {}, `${p.days} days, about ${Math.round(planChapters(p.id) / p.days * 10) / 10} chapters a day`)));
    }));
    const trSel = el('select', { onchange: e => { tr = e.target.value; } }, ...Object.entries(b.translations).map(([id, name]) => el('option', { value: id }, name)));
    trSel.value = tr;
    const start = el('input', { type: 'date', value: todayISO() });
    if (token !== bibleToken) return;
    box.replaceChildren(...[
      verseCard(verse, todayISO(), 'rv'),
      el('h2', { class: 'rv-title' }, 'Read through the Bible'),
      el('p', { class: 'rv-intro' }, 'Pick a plan and each day’s reading appears here. Tick it off when you’ve read it, and write about it in your journal.'),
      opts,
      el('div', { class: 'plan-row' }, el('label', {}, 'Translation ', trSel), el('label', {}, 'Start on ', start)),
      el('button', { type: 'button', class: 'btn-ink', onclick: async () => { await saveBible({ plan, translation: tr, start: start.value || todayISO(), done: [] }); state.bibleDay = null; renderBibleView(); } }, 'Start reading plan'),
      el('p', { class: 'rv-note' }, 'World English Bible: a modern translation in the public domain. King James Version: the 1769 text. Both are built in and work offline.'),
    ].filter(Boolean));
    return;
  }

  const days = planDays();
  const today = todayPlanDay();
  const day = Math.max(0, Math.min(days - 1, state.bibleDay == null ? today : state.bibleDay));
  let r;
  try { r = await api.bibleReading(st.plan, day, st.translation); } catch (x) { box.replaceChildren(el('p', {}, x.message)); return; }
  if (token !== bibleToken) return;
  const done = new Set(st.done);
  const isDone = done.has(day);
  const behind = [...Array(Math.max(0, Math.min(today, days)))].map((_, i) => i).filter(i => !done.has(i));
  const dayDate = (() => { const d = dateOf(st.start); d.setDate(d.getDate() + day); return isoOf(d); })();
  const planName = b.plans.find(p => p.id === st.plan).name;
  const go = d => { state.bibleDay = d; renderBibleView(); $('#sheetScroll').scrollTop = 0; };

  const markBtn = el('button', { type: 'button', class: isDone ? 'btn-plain done' : 'btn-ink', onclick: async () => {
    const set = new Set(state.bible.state.done);
    isDone ? set.delete(day) : set.add(day);
    await saveBible({ done: [...set] });
    if (!isDone) toast(set.size === days ? 'Plan complete. Well done.' : `Day ${day + 1} read`);
    renderBibleView();
  } }, isDone ? '✓ Read' : 'Mark as read');

  box.replaceChildren(...[
    day === today ? verseCard(verse, todayISO(), 'rv') : null,
    el('div', { class: 'rv-head' },
      el('div', {},
        el('p', { class: 'rv-kicker' }, `${planName}, ${st.translation.toUpperCase()}`),
        el('h2', { class: 'rv-title' }, `Day ${day + 1} `, el('span', {}, `of ${days}`)),
        el('p', { class: 'rv-ref' }, r.label, el('small', {}, ` ${fmt(dayDate, { weekday: 'long', day: 'numeric', month: 'long' })}`))),
      el('div', { class: 'rv-nav' },
        el('button', { type: 'button', class: 'icon-btn', title: 'Previous day', 'aria-label': 'Previous day', disabled: day <= 0, onclick: () => go(day - 1) }, '‹'),
        day !== today && today >= 0 && today < days ? el('button', { type: 'button', class: 'btn-link', onclick: () => go(null) }, 'Today') : null,
        el('button', { type: 'button', class: 'icon-btn', title: 'Next day', 'aria-label': 'Next day', disabled: day >= days - 1, onclick: () => go(day + 1) }, '›'))),
    el('div', { class: 'rv-progress', title: `${done.size} of ${days} days read` },
      el('div', { style: `width:${(done.size / days) * 100}%` })),
    el('p', { class: 'rv-status' }, `${done.size} of ${days} days read`,
      behind.length > 1 && day === today ? el('button', { type: 'button', class: 'btn-link', onclick: () => go(behind[0]) }, ` Catch up from day ${behind[0] + 1}`) : null,
      today >= days ? ' You’ve reached the end of the plan.' : null),
    el('div', { class: 'rv-actions' }, markBtn,
      el('button', { type: 'button', class: 'btn-plain', onclick: () => writeAboutReading(r) }, 'Write about this reading'),
      el('button', { type: 'button', class: 'btn-link', onclick: biblePlanSettings }, 'Plan settings')),
    el('article', { class: 'passage' }, ...r.chapters.flatMap(renderPassage)),
    el('div', { class: 'rv-actions end' }, markBtn.cloneNode(true),
      day < days - 1 ? el('button', { type: 'button', class: 'btn-plain', onclick: () => go(day + 1) }, 'Next day ›') : null),
    el('p', { class: 'rv-note' }, `${b.translations[st.translation]}, public domain.`),
  ].filter(Boolean));
  // the cloned button needs the handler too
  box.querySelector('.rv-actions.end button').addEventListener('click', () => markBtn.click());
}

function planChapters(id) {
  return { year: 1189, 'ot-nt': 1189, nt90: 260, gospels30: 89, psalms60: 181 }[id] || 0;
}

async function writeAboutReading(r) {
  const iso = todayISO();
  setMode('journal');
  const existing = sorted(state.metas.filter(m => m.date === iso))[0];
  if (!state.current || state.current.date !== iso) { if (existing) await openEntry(existing.id); else await newEntry(iso); }
  const p = el('blockquote', {}, `Today’s reading: ${r.label} (${r.translation})`);
  const after = el('p', {}, el('br'));
  body.prepend(p, after);
  body.focus();
  const range = document.createRange(); range.setStart(after, 0); range.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  markDirty(); updateCounts();
}

function biblePlanSettings() {
  const b = state.bible, st = b.state;
  return openDialog((f, done) => {
    const plan = el('select', {}, ...b.plans.map(p => el('option', { value: p.id }, `${p.name} (${p.days} days)`)));
    plan.value = st.plan;
    const tr = el('select', {}, ...Object.entries(b.translations).map(([id, name]) => el('option', { value: id }, name)));
    tr.value = st.translation;
    const start = el('input', { type: 'date', value: st.start });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const changedPlan = plan.value !== st.plan || start.value !== st.start;
      await saveBible({ plan: plan.value, translation: tr.value, start: start.value || st.start, done: changedPlan ? [] : st.done });
      state.bibleDay = null; done(); renderBibleView(); refreshQuote();
    });
    f.append(el('h2', {}, 'Reading plan'),
      el('p', {}, 'Changing the plan or start date starts your progress again. Changing the translation keeps it.'),
      el('label', { class: 'field' }, 'Plan', plan),
      el('label', { class: 'field' }, 'Translation', tr),
      el('label', { class: 'field' }, 'Day 1 was', start),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'btn-link danger', style: 'margin-right:auto', onclick: async () => { await saveBible({ plan: '', start: '', done: [] }); done(); renderBibleView(); } }, 'Stop this plan'),
        el('button', { type: 'button', class: 'btn-plain', onclick: () => done() }, 'Cancel'),
        el('button', { type: 'submit', class: 'btn-ink' }, 'Save')));
  });
}

// --- The weekly page, laid out like a devotional book
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const bibleTr = () => (state.bible && state.bible.state.translation) || 'web';

async function versesFor(refs) {
  const k = refs.join('|') + bibleTr();
  if (!state.verseCache[k]) state.verseCache[k] = await api.verses(refs, bibleTr());
  return state.verseCache[k];
}
async function pictureFor(key) {
  if (!(key in state.pictures)) {
    try { state.pictures[key] = (await api.getPicture(key)) || ''; } catch { state.pictures[key] = ''; }
  }
  return state.pictures[key];
}
/** Shrink a chosen picture to a sensible size before it is encrypted and stored. */
async function shrinkPicture(file, max = 1800) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  return c.toDataURL('image/jpeg', 0.86);
}
function choosePicture(key) {
  const input = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif,image/bmp' });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    try {
      const url = await shrinkPicture(f);
      await api.setPicture(key, url);
      state.pictures[key] = url;
      toast('Picture added to this week');
    } catch (e) { toast('That picture couldn’t be used: ' + (e.message || e)); }
    renderQuoteView();
  });
  input.click();
}

/** The week's page: picture, theme, week number and title, Scripture, the day's quote and question,
 *  the week's readings, a prayer and a blessing. */
async function renderWeekView(today, season) {
  const box = $('#quoteView');
  const iso = state.weekAt || today;   // a day in the week being shown
  const s = state.weekAt ? seasonOn(iso) : season;
  const week = window.WellWriteWeeks.weekOf(s);
  const start = addDays(iso, week.firstDay - s.dayIndex);
  const days = Array.from({ length: week.lastDay - week.firstDay + 1 }, (_, i) => addDays(start, i));
  const focus = days.includes(today) ? today : days[0];
  const q = quoteFor(focus), prompt = promptFor(focus);
  const [verses, blessing, picture] = await Promise.all([versesFor(week.verses), versesFor([week.blessing]), pictureFor(week.key)]);
  if (state.mode !== 'quote') return;
  const btn = (label, fn, cls = 'btn-plain', title) => el('button', { type: 'button', class: cls, onclick: fn, title }, label);
  const short = d => fmt(d, { day: 'numeric', month: 'short' });
  const goWeek = n => { state.weekAt = n < 0 ? addDays(days[0], -1) : addDays(days.at(-1), 1); renderQuoteView(); $('#quoteView').scrollTop = 0; };
  const sign = x => el('p', { class: 'wk-sign' }, x.author || 'Unknown', x.source ? ', ' : '', x.source ? el('cite', {}, x.source) : null);
  const shown = verses.filter(Boolean);
  // Your own writing: a reflection each week, and your prayers and blessings taking turns with the book's.
  const readingIds = new Set(days.map(d => (quoteFor(d) || {}).id));
  const year = +days[0].slice(0, 4);
  const own = kinds => { const pool = seasonPool(s).filter(x => ownish(x) && kinds.includes(x.kind || '')); return pool.length ? pool : null; };
  const pickOwn = (pool, avoid) => { if (!pool) return null; const p = pool.filter(x => !avoid.has(x.id)); const from = p.length ? p : pool; return from[(week.index + year * 5) % from.length]; };
  const ownLong = own(['', 'reflection', 'fieldnote', 'psalm', 'poem']);
  const reflection = pickOwn(ownLong && (ownLong.filter(x => !isReading(x)).length ? ownLong.filter(x => !isReading(x)) : ownLong), readingIds);
  const myPrayer = week.number % 2 === 0 ? pickOwn(own(['prayer']), readingIds) : null;
  const myBlessing = week.number % 2 === 1 ? pickOwn(own(['blessing']), readingIds) : null;
  const kindHead = { psalm: 'A Psalm', poem: 'A Poem', reflection: 'A Reflection', fieldnote: 'From the field', '': 'A Reflection' };

  box.replaceChildren(el('article', { class: 'week-page' }, ...[
    el('nav', { class: 'wk-nav' },
      btn('‹ Previous week', () => goWeek(-1), 'btn-link'),
      !days.includes(today) ? btn('Back to this week', () => { state.weekAt = null; renderQuoteView(); }, 'btn-link') : el('span', {}, `${short(days[0])} – ${short(days.at(-1))}`),
      btn('Next week ›', () => goWeek(1), 'btn-link')),
    picture
      ? el('figure', { class: 'wk-picture' }, el('img', { src: picture, alt: '' }),
        el('div', { class: 'wk-picture-tools' },
          btn('Change picture', () => choosePicture(week.key), 'pic-btn'),
          btn('Remove', async () => { await api.removePicture(week.key); state.pictures[week.key] = ''; renderQuoteView(); }, 'pic-btn')))
      : btn('＋ Add a picture for this week', () => choosePicture(week.key), 'wk-add-picture', 'The picture comes back with this week each year'),
    el('p', { class: 'wk-running' }, `Theme: ${s.name}`),
    el('div', { class: 'wk-head' },
      el('p', { class: 'wk-label' }, 'Week'),
      el('div', { class: 'wk-number' }, el('span', { class: 'wk-flourish', 'aria-hidden': 'true' }, '❧'), el('b', {}, String(week.number)), el('span', { class: 'wk-flourish flip', 'aria-hidden': 'true' }, '❧')),
      el('h2', { class: 'wk-title' }, week.title),
      el('p', { class: 'wk-about' }, `${s.about}. Week ${week.number} of ${week.weeks}.`)),
    el('hr', { class: 'wk-rule swash' }),
    shown.length ? el('section', { class: 'wk-scripture' },
      ...shown.map(v => el('p', {}, v.text)),
      el('p', { class: 'wk-refs' }, '(' + shown.map(v => v.ref).join('; ') + ', ' + shown[0].translation + ')')) : null,
    el('hr', { class: 'wk-rule' }),
    reflection ? el('section', { class: 'wk-reflection' + (['psalm', 'poem'].includes(reflection.kind) ? ' verse' : '') },
      el('h4', {}, kindHead[reflection.kind || ''], reflection.title ? el('i', {}, ': ' + reflection.title) : null),
      el('div', { class: 'wk-reflection-text' }, ...reflection.text.split(/\n\s*\n/).map(par => el('p', {}, par))),
      sign(reflection),
      btn('Write about this', () => writeAboutQuote(reflection, today, prompt), 'btn-link small')) : null,
    reflection ? el('hr', { class: 'wk-rule' }) : null,
    q ? el('section', { class: 'wk-today' },
      el('p', { class: 'wk-day' }, focus === today ? 'Today, ' + fmt(focus, { weekday: 'long', day: 'numeric', month: 'long' }) : fmt(focus, { weekday: 'long', day: 'numeric', month: 'long' })),
      el('blockquote', {}, q.text), sign(q),
      prompt ? el('div', { class: 'big-prompt' }, el('p', {}, prompt),
        btn('Another question', () => { state.promptSkip[focus] = (state.promptSkip[focus] || 0) + 1; renderQuoteView(); }, 'btn-link')) : null,
      el('div', { class: 'rv-actions center' },
        btn('Write about this', () => writeAboutQuote(q, today, prompt), 'btn-ink'),
        state.quotes.length > 1 ? btn('Another quote', () => { state.quoteSkip[focus] = (state.quoteSkip[focus] || 0) + 1; renderQuoteView(); }) : null,
        btn(q.fav ? '★ Favourite' : '☆ Favourite', async () => { await saveQuotes(state.quotes.map(x => (x.id === q.id ? { ...x, fav: !x.fav } : x))); renderQuoteView(); }),
        btn('Your quotes', () => manageQuotes(), 'btn-link'))) : el('section', { class: 'wk-today' },
      el('p', { class: 'rv-intro' }, 'Add quotes from writers you love and they will be chosen to suit each week.'), btn('Add quotes', () => manageQuotes(), 'btn-ink')),
    el('section', { class: 'wk-readings' }, el('h3', {}, 'Readings for the week'),
      ...days.map(d => ({ d, x: quoteFor(d) })).filter(r => r.x).map(({ d, x }) => el('div', { class: 'wk-reading' + (d === focus ? ' now' : '') },
        el('p', { class: 'wk-when' }, fmt(d, { weekday: 'long' }), d === today ? ' · today' : ''),
        el('blockquote', {}, x.text), sign(x),
        d !== focus ? btn('Write about this', () => writeAboutQuote(x, today, promptFor(d)), 'btn-link small') : null))),
    el('hr', { class: 'wk-rule' }),
    myPrayer ? el('section', { class: 'wk-prayer' }, ...myPrayer.text.split(/\n\s*\n/).map(par => el('p', {}, par)), sign(myPrayer))
      : el('section', { class: 'wk-prayer' }, el('p', {}, week.prayer)),
    el('hr', { class: 'wk-rule' }),
    myBlessing ? el('section', { class: 'wk-blessing' }, el('h4', {}, 'A Benediction'), el('p', {}, myBlessing.text), sign(myBlessing))
      : blessing[0] ? el('section', { class: 'wk-blessing' }, el('h4', {}, 'A Benediction'), el('p', {}, blessing[0].text), el('p', { class: 'wk-refs' }, `${blessing[0].ref}, ${blessing[0].translation}`)) : null,
    el('div', { class: 'wk-ornament', 'aria-hidden': 'true' }, '❦'),
    seasonYear(today),
  ].filter(Boolean)));
}

// --- Quote of the day, full page (or the weekly page when following a year of themes)
function renderQuoteView() {
  const box = $('#quoteView');
  const iso = todayISO();
  const season = seasonOn(iso);
  if (season && window.WellWriteWeeks) { renderWeekView(iso, season).catch(e => toast('Couldn’t show this week: ' + (e.message || e))); return; }
  const q = quoteFor(iso);
  if (!q) {
    box.replaceChildren(el('h2', { class: 'rv-title' }, 'Quote of the day'),
      el('p', { class: 'rv-intro' }, 'Add quotes from writers you love and one will appear here each day.'),
      el('button', { type: 'button', class: 'btn-ink', onclick: () => manageQuotes() }, 'Add quotes'));
    return;
  }
  const btn = (label, fn, cls = 'btn-plain') => el('button', { type: 'button', class: cls, onclick: fn }, label);
  const prompt = promptFor(iso);
  const earlier = [1, 2, 3, 4, 5, 6].map(n => { const d = dateOf(iso); d.setDate(d.getDate() - n); return isoOf(d); })
    .map(d => ({ d, q: quoteFor(d) })).filter(x => x.q && x.q.id !== q.id);
  box.replaceChildren(...[
    season ? el('div', { class: 'season-head' },
      el('p', { class: 'season-name' }, season.name),
      el('p', { class: 'season-about' }, `${season.about}. Day ${season.dayIndex + 1} of ${season.length}.`)) : null,
    el('p', { class: 'rv-kicker' }, fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })),
    el('figure', { class: 'big-quote' },
      el('blockquote', {}, q.text),
      el('figcaption', {}, '— ' + (q.author || 'Unknown') + (q.source ? ', ' : ''), q.source ? el('cite', {}, q.source) : null),
      (q.themes || []).length ? el('div', { class: 'q-themes' }, ...q.themes.map(t => el('button', { type: 'button', class: 'theme-chip mini', title: `Show quotes about ${t}`,
        onclick: () => { quoteThemeFilter = t; manageQuotes(); } }, t))) : null),
    prompt ? el('div', { class: 'big-prompt' }, el('p', {}, prompt),
      el('button', { type: 'button', class: 'btn-link', onclick: () => { state.promptSkip[iso] = (state.promptSkip[iso] || 0) + 1; renderQuoteView(); } }, 'Another question')) : null,
    el('div', { class: 'rv-actions center' },
      btn('Write about this', () => writeAboutQuote(q, iso, prompt), 'btn-ink'),
      state.quotes.length > 1 ? btn('Another', () => { state.quoteSkip[iso] = (state.quoteSkip[iso] || 0) + 1; renderQuoteView(); }) : null,
      btn(q.fav ? '★ Favourite' : '☆ Favourite', async () => { await saveQuotes(state.quotes.map(x => (x.id === q.id ? { ...x, fav: !x.fav } : x))); renderQuoteView(); }),
      btn('Your quotes', () => manageQuotes(), 'btn-link')),
    earlier.length ? el('div', { class: 'earlier' }, el('h3', {}, 'Earlier this week'),
      ...earlier.map(({ d, q: e }) => el('button', { type: 'button', class: 'earlier-item', onclick: () => writeAboutQuote(e, iso), title: 'Write about this today' },
        el('small', {}, fmt(d, { weekday: 'long' })), el('span', {}, e.text.split('\n')[0]), el('em', {}, e.author)))) : null,
    seasonYear(iso),
  ].filter(Boolean));
}

/** This year's seasons, with dates and how many of your quotes suit each. */
function seasonYear(iso) {
  const plan = quotePlan();
  if (plan === 'off' || !window.WellWriteSeasons) return el('div', { class: 'earlier' }, el('h3', {}, 'The year of themes'),
    el('p', { class: 'season-note' }, 'Quotes are chosen from your whole collection. Choose the Christian year or monthly themes to have each day’s quote and question follow the seasons.'),
    el('button', { type: 'button', class: 'btn-plain', onclick: () => manageQuotes() }, 'Choose'));
  const y = +iso.slice(0, 4);
  const list = window.WellWriteSeasons.seasonsFor(y, plan);
  const short = d => fmt(d, { day: 'numeric', month: 'short' });
  return el('div', { class: 'earlier season-year' },
    el('h3', {}, plan === 'christian' ? `The Christian year, ${y}` : `Monthly themes, ${y}`),
    ...list.map(s => {
      const n = seasonPool(s).length;
      return el('div', { class: 'season-row' + (s.start <= iso && iso <= s.end ? ' now' : '') },
        el('small', {}, `${short(s.start)} – ${short(s.end)}`),
        el('span', {}, el('b', {}, s.name), ` ${s.about}`),
        el('em', { title: 'Quotes in your collection that suit this season' }, n ? `${n} quotes` : 'no quotes yet'));
    }),
    el('p', { class: 'season-note' }, 'Each day’s quote is picked from those whose themes suit the season, best fitting first, without repeats until the season’s quotes run out.'));
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
      row('Daily quote', 'Choose what appears above your journal with “Above journal” at the top right.', el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); manageQuotes(); } }, 'Your quotes')),
      row('Categories', 'Group entries into sections, like a notebook.', el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); manageCategories(); } }, 'Edit categories')),
      row('Check spelling', 'Underlines misspelled words. Right-click for suggestions.', check(s.spellcheck, v => updateSetting({ spellcheck: v }))),

      el('h3', {}, 'Privacy'),
      row('Lock after inactivity', null, select(s.autoLockMinutes, [['1', '1 minute'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['0', 'Never']], v => updateSetting({ autoLockMinutes: +v }))),
      row('Remember my password', 'When WellWrite locks, your writing is hidden either way. With these, you open it again with one click.', trustSelect()),
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

function trustSelect() {
  const sel = el('select', { 'aria-label': 'Remember my password' },
    el('option', { value: 'ask' }, 'No, ask every time'),
    el('option', { value: 'hour' }, 'For an hour after I type it'),
    el('option', { value: 'trust' }, 'Always, on this computer'));
  api.status().then(st => {
    const t = st.trust || { mode: 'ask' };
    sel.value = t.active || t.mode === 'hour' ? t.mode : 'ask';
    if (!t.available) { sel.disabled = true; sel.title = 'Windows can’t protect a saved password on this computer'; }
  }).catch(() => {});
  sel.addEventListener('change', async () => {
    const mode = sel.value;
    if (mode === 'trust') {
      const ok = await confirmDialog({
        title: 'Trust this computer?',
        text: 'WellWrite will open without your password whenever you’re signed in to Windows on this computer. Anyone who can use your Windows account could read your journal. Your password is still needed on any other computer and to restore backups.',
        ok: 'Trust this computer',
      });
      if (!ok) { openSettings(); return; }
    }
    try {
      await api.setTrust(mode);
      toast({ ask: 'WellWrite will ask for your password every time', hour: 'No password needed for the next hour', trust: 'This computer is trusted' }[mode]);
    } catch (x) { toast(x.message); }
    if (mode === 'trust') openSettings();
  });
  return sel;
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
    else if (k === '1' || k === '2' || k === '3') { e.preventDefault(); setMode(['journal', 'bible', 'quote'][+k - 1]); }
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
