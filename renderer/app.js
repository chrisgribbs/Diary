'use strict';
/* WellWrite — renderer */
const api = window.wellwrite;
// On Android the same page runs in the WellWrite app; a few words and options differ.
const ANDROID = api.platform === 'android';
const HERE = ANDROID ? 'this phone' : 'this computer';
// Phones and tablets: putting the cursor in a box pops up the keyboard, which squeezes the screen and makes the next
// tap miss what it was aimed at. So boxes you might not type in aren't focused on a touch screen.
const TOUCH = ANDROID || matchMedia('(pointer: coarse)').matches;
/** Focus a text box, unless on a touch screen (where it would open the keyboard) and typing isn't the point. */
function focusTyping(input, typingIsThePoint = false) { if (input && (!TOUCH || typingIsThePoint)) input.focus(); }
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
  pen: '<svg viewBox="0 0 20 20"><path d="M4 16l1-4 8.5-8.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L8 15z"/><path d="M12 5l3 3"/></svg>',
  photo: '<svg viewBox="0 0 20 20"><rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.4"/><path d="M3.5 14.5l4-4 3 3 2-2 4 4"/></svg>',
  xref: '<svg viewBox="0 0 20 20"><path d="M3.5 3.5h6v8h-6zM10.5 8.5h6v8h-6z"/><path d="M9.5 6h2.5a2 2 0 0 1 2 2v.5M10.5 14H8a2 2 0 0 1-2-2v-.5"/></svg>',
  back: '<svg viewBox="0 0 20 20"><path d="M11 5l-5 5 5 5"/></svg>',
};

/* ---------- state ---------- */
const state = {
  photoThumbs: new Map(),   // entry → small copies of its photos, for the Photos view (this session only)
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
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'data-ink'],   // data-ink: the pen strokes of a handwritten page (ink.js)
  ALLOW_DATA_ATTR: false,
  ADD_URI_SAFE_ATTR: ['data-ink'],   // not a link: its value is checked in the hook below
  // Web links, email, and links to other entries. (Photos are data: images, which DOMPurify allows on <img>.)
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|wellwrite:entry\/)/i,
};
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'IMG' && !/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(node.getAttribute('src') || '')) node.remove();
  if (node.hasAttribute && node.hasAttribute('data-ink') && (node.tagName !== 'IMG' || !/^v1:[A-Za-z0-9+/]+=*$/.test(node.getAttribute('data-ink')))) node.removeAttribute('data-ink');
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
/** Note something in the problems log (Settings → About). Never entry text. */
function diag(msg) { try { api.log(String(msg)).catch(() => {}); } catch {} }
window.addEventListener('error', e => diag(`error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', e => diag(`error: ${(e.reason && (e.reason.stack || e.reason.message)) || e.reason}`.slice(0, 500)));
const caller = () => ((new Error().stack || '').split('\n')[3] || '').trim().replace(/\(.*\/(?=[^/]+\))/, '(');

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
    // Always closes, whatever happened inside the dialog.
    const done = v => {
      resolve(v); try { dlg.close(); } catch (x) { diag('dialog close failed: ' + x.message); }
      if (dlg.open) { dlg.removeAttribute('open'); diag('dialog needed forcing shut'); }
      const was = form;
      setTimeout(() => { if (dlg.open && $('#dlgForm') !== was && form.classList.contains('settings-page')) diag('settings reopened straight after closing'); }, 400);
    };
    build(form, done);
    addReveal(form);
    dlg.classList.toggle('page', form.classList.contains('page') || form.classList.contains('wide'));
    // The close event is async; ignore a stale one that lands after a new dialog opened.
    dlg.onclose = () => { if (!dlg.open) resolve(undefined); };
    dlg.showModal();
    const f = form.querySelector('[autofocus]');
    if (f && (!TOUCH || f.tagName === 'BUTTON' || f.type === 'password')) f.focus();
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
  document.querySelectorAll('.here').forEach(n => { n.textContent = HERE; });
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
  syncSystemBars();
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
      : (ANDROID ? 'This phone is trusted' : 'This computer is trusted') + ', so no password is needed.';
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
  api.syncStatus().then(st => { state.sync = st; renderSyncState(); }).catch(() => {});
  await syncReadings();
  try { state.bible = await api.bibleInfo(); } catch { state.bible = null; }
  state.bibleDay = null;
  state.selectedDay = null; state.query = ''; state.tag = null; state.category = null; state.trail = []; $('#search').value = '';
  const d = new Date(); state.viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  $('#lock').hidden = true;
  $('#app').hidden = false;
  syncSystemBars();
  const today = sorted(state.metas.filter(m => m.date === todayISO()))[0];
  const mode = state.mode;
  if (today) await openEntry(today.id, { keepMode: true }); else showEmpty();
  state.mode = mode;
  renderSidebar();
  refreshBackupInfo();
  setMode(state.mode);
  // Something waiting for the journal to be open (turning on sync after signing in to Google).
  const next = state.afterUnlock; state.afterUnlock = null;
  if (next) setTimeout(next, 300);
}

/** Signing in to Google happens in the browser; the journal mustn't lock itself meanwhile (that broke turning on sync). */
async function whileSigningIn(fn) {
  state.signingIn = (state.signingIn || 0) + 1;
  try { return await fn(); } finally { state.signingIn--; state.lastActivity = Date.now(); }
}
async function lockNow({ auto = false } = {}) {
  if (!state.unlocked) return;
  if (auto && state.signingIn) return;
  await saveNow();
  state.unlocked = false;
  try { await api.lock(); } catch {}
  // Wipe everything readable from the page.
  state.metas = []; state.current = null; state.categories = []; state.trail = []; state.quotes = []; state.bible = null; state.verseCache = {}; state.pictures = {}; state.weekAt = null; state.photoThumbs = new Map();
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

  // With no search, day, tag or category chosen, the sidebar keeps to your two most recent days;
  // everything else is a click away on the All entries page.
  const browsing = !state.selectedDay && !state.query && !state.tag && state.category == null;
  let shown = items;
  if (browsing) {
    const days = [...new Set(items.map(m => m.date))].slice(0, 2);
    shown = items.filter(m => days.includes(m.date));
    if (state.current && !shown.some(m => m.id === state.current.id)) {
      const cur = items.find(m => m.id === state.current.id);
      if (cur) shown = [...shown, cur];
    }
  }
  let month = '';
  for (const m of shown) {
    const mk = m.date.slice(0, 7);
    if (mk !== month) { month = mk; list.append(el('div', { class: 'list-month' }, fmt(m.date, { month: 'long', year: 'numeric' }))); }
    list.append(entryItem(m, () => openEntry(m.id)));
  }
  if (browsing && items.length > shown.length) {
    list.append(el('button', { type: 'button', class: 'all-entries-btn', id: 'allEntriesBtn', onclick: () => openAllEntries() },
      el('span', {}, 'All entries'), el('b', {}, String(items.length)), el('span', { class: 'chev', 'aria-hidden': 'true' }, '›')));
  }
}

/** One entry in a list: date, title (with its category's colour), opening words, time, photos, tags and links. */
function entryItem(m, onOpen) {
  const title = el('div', { class: 'item-title' });
  title.innerHTML = highlight(m.title || dateTitle(m.date));
  const cat = catById(m.category);
  if (cat) title.prepend(el('span', { class: 'dot', style: `background:${cat.color}`, title: catPath(cat) }));
  const ex = el('div', { class: 'item-ex' }); ex.innerHTML = excerpt(m);
  const meta = el('div', { class: 'item-meta' });
  if (m.time) meta.append(el('span', {}, m.time));
  if (m.images) { const s = el('span'); s.innerHTML = ICON.photo + ' ' + m.images; meta.append(s); }
  if (m.ink) { const s = el('span', { title: 'Handwritten pages' }); s.innerHTML = ICON.pen + ' ' + m.ink; meta.append(s); }
  if (m.tags.length) meta.append(el('span', {}, m.tags.slice(0, 3).map(t => '#' + t).join(' ')));
  const links = (m.links || []).length + state.metas.filter(x => x.links && x.links.includes(m.id)).length;
  if (links) { const s = el('span', { title: 'Connected entries' }); s.innerHTML = ICON.xref + ' ' + links; meta.append(s); }
  return el('button', {
    class: 'item' + (state.current && state.current.id === m.id ? ' active' : ''),
    'data-id': m.id, onclick: onOpen,
  },
    el('div', { class: 'item-date' }, el('b', {}, String(dateOf(m.date).getDate())), el('span', {}, fmt(m.date, { weekday: 'short' }))),
    el('div', { class: 'item-main' }, title, m.text.trim() ? ex : null, meta.childNodes.length ? meta : null));
}

/** Every entry, on a page of its own: search, and filter by category, tag and month. */
function openAllEntries() {
  return openDialog((f, done) => {
    f.classList.add('page', 'all-entries');
    const find = el('input', { type: 'search', id: 'aeFind', placeholder: 'Search your entries', 'aria-label': 'Search your entries' });
    const catSel = el('select', { id: 'aeCat', 'aria-label': 'Category' }, el('option', { value: '*' }, 'All categories'), el('option', { value: '' }, 'No category'),
      ...state.categories.filter(c => !c.parent).flatMap(c => [el('option', { value: c.id }, c.name),
        ...state.categories.filter(x => x.parent === c.id).map(x => el('option', { value: x.id }, '\u00a0\u00a0' + x.name))]));
    const tags = [...tagCounts().entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const tagSel = el('select', { id: 'aeTag', 'aria-label': 'Tag' }, el('option', { value: '' }, 'All tags'), ...tags.map(([t, n]) => el('option', { value: t }, `#${t} (${n})`)));
    const months = [...new Set(state.metas.map(m => m.date.slice(0, 7)))].sort().reverse();
    const monthSel = el('select', { id: 'aeMonth', 'aria-label': 'Month' }, el('option', { value: '' }, 'All months'), ...months.map(mk => el('option', { value: mk }, fmt(mk + '-01', { month: 'long', year: 'numeric' }))));
    const order = el('select', { id: 'aeOrder', 'aria-label': 'Order' }, el('option', { value: 'new' }, 'Newest first'), el('option', { value: 'old' }, 'Oldest first'));
    const count = el('p', { class: 'ae-count' });
    const list = el('div', { class: 'ae-list' });
    const draw = () => {
      const q = find.value.trim().toLowerCase();
      let items = sorted(state.metas).filter(m =>
        (catSel.value === '*' || inCategory(m, catSel.value)) &&
        (!tagSel.value || m.tags.includes(tagSel.value)) &&
        (!monthSel.value || m.date.startsWith(monthSel.value)) &&
        (!q || [m.title, m.text, m.tags.map(t => '#' + t).join(' ')].join(' ').toLowerCase().includes(q)));
      if (order.value === 'old') items = items.reverse();
      count.textContent = items.length === state.metas.length ? `${items.length} entr${items.length === 1 ? 'y' : 'ies'}` : `${items.length} of ${state.metas.length} entries`;
      list.replaceChildren();
      let month = '';
      for (const m of items) {
        const mk = m.date.slice(0, 7);
        if (mk !== month) { month = mk; list.append(el('div', { class: 'list-month' }, fmt(m.date, { month: 'long', year: 'numeric' }))); }
        list.append(entryItem(m, () => { done(); openEntry(m.id); }));
      }
      if (!items.length) list.append(el('p', { class: 'ae-none' }, 'No entries match. Try fewer words, or clear a filter.'));
    };
    for (const c of [find, catSel, tagSel, monthSel, order]) c.addEventListener(c === find ? 'input' : 'change', draw);
    f.append(
      el('div', { class: 'ae-head' },
        el('button', { type: 'button', class: 'btn-plain back-journal', onclick: () => done() }, '‹ Back to my journal'),
        el('h2', {}, 'All entries')),
      el('div', { class: 'ae-filters' }, find, catSel, tagSel, monthSel, order),
      count, list);
    draw();
    setTimeout(() => focusTyping(find));
  });
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
    if (state.sideView === 'tags') focusTyping($('#tagFind'));
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
      ? 'Write about today, or anything at all. Entries are encrypted with your password and stay on ' + HERE + '.'
      : 'Nothing written yet today. A few lines is enough.'),
    el('button', { class: 'btn-ink', onclick: () => newEntry(todayISO()) }, 'Write today’s entry'),
  ].filter(Boolean));
  fillDaily($('#emptyDaily'), todayISO(), 'empty');
}

function showSheet() {
  $('#empty').hidden = true; $('#sheet').hidden = false; $('#pageFoot').hidden = false;
  updateWpButton();
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
  titleIn.value = e.title || dateTitle(e.date); requestAnimationFrame(fitTitle);
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
  titleIn.value = dateTitle(date); requestAnimationFrame(fitTitle); body.innerHTML = '';
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
  if (!state.dirty && state.current.saved) api.syncHold(state.current.id).catch(() => {});   // sync leaves it alone while you type
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
    if (state.current === c && !state.dirty) { $('#saveState').textContent = 'Saved'; api.syncHold('').catch(() => {}); }
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
titleIn.addEventListener('input', () => { titleIn.value = titleIn.value.replace(/\s*\n+\s*/g, ' '); fitTitle(); markDirty(); });
/** The title wraps onto as many lines as it needs, so a long one is never cut off. */
function fitTitle() { titleIn.style.height = 'auto'; titleIn.style.height = titleIn.scrollHeight + 'px'; }
window.addEventListener('resize', () => fitTitle());
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
  if (wasDefault) { titleIn.value = dateTitle(state.current.date); fitTitle(); }
  renderStamp(); markDirty();
});
$('#stampTime').onclick = () => { timeInput.value = state.current.time || nowTime(); timeInput.showPicker(); };
timeInput.addEventListener('change', () => { state.current.time = timeInput.value; renderStamp(); markDirty(); });

// Delete
/* ---------- WordPress: post an entry to your own site ---------- */
let wpConnected = false;
async function updateWpButton() {
  const b = $('#wpBtn');
  try { wpConnected = (await api.wpStatus()).connected; } catch { wpConnected = false; }
  const c = state.current;
  b.hidden = !wpConnected || !c;
  if (b.hidden) return;
  let rec = null; try { rec = await api.wpRecord(c.id); } catch {}
  if (state.current !== c) return;
  b.textContent = rec ? (rec.status === 'publish' ? 'Update on WordPress' : 'Update WordPress draft') : 'Post to WordPress';
}
$('#wpBtn').onclick = () => postToWordPress();

/**
 * The entry as WordPress blocks, so it stays editable in the block editor: paragraphs, headings, lists, quotes
 * (with the writer as the citation), separators and images. Photos become ⟦img:N:url⟧ / ⟦img:N:id⟧ placeholders
 * that are filled in once they're uploaded. Links to other entries point at their posts, if posted; otherwise plain text.
 */
function entryToWordPress(html, links = {}) {
  const root = document.createElement('div');
  root.innerHTML = clean(html);
  const images = [];
  const imgIndex = src => { let i = images.indexOf(src); if (i < 0) { images.push(src); i = images.length - 1; } return i; };
  for (const a of root.querySelectorAll('a[href^="wellwrite:entry/"]')) {
    const url = links[a.getAttribute('href').slice('wellwrite:entry/'.length)];
    if (url) { const n = el('a', { href: url }, a.textContent); a.replaceWith(n); } else a.replaceWith(document.createTextNode(a.textContent));
  }
  for (const n of root.querySelectorAll('*')) for (const at of [...n.attributes]) if (!['href', 'src', 'alt'].includes(at.name)) n.removeAttribute(at.name);
  const blocks = [];
  const para = h => { if (h.replace(/<br\s*\/?>|&nbsp;|\s/g, '')) blocks.push(`<!-- wp:paragraph -->
<p>${h.trim()}</p>
<!-- /wp:paragraph -->`); };
  const image = src => { if (!/^data:image\//.test(src)) return; const i = imgIndex(src);
    blocks.push(`<!-- wp:image {"id":⟦img:${i}:id⟧,"sizeSlug":"large","linkDestination":"none"} -->
<figure class="wp-block-image size-large"><img src="⟦img:${i}:url⟧" alt="" class="wp-image-⟦img:${i}:id⟧"/></figure>
<!-- /wp:image -->`); };
  // A paragraph with photos in it: the words around each photo stay paragraphs, each photo its own block.
  const withImages = node => {
    let buf = '';
    for (const k of node.childNodes) {
      if (k.nodeName === 'IMG') { para(buf); buf = ''; image(k.getAttribute('src') || ''); }
      else if (k.nodeType === 1 && k.querySelector && k.querySelector('img')) { para(buf); buf = ''; withImages(k); }
      else buf += k.nodeType === 3 ? escHtml(k.textContent) : k.outerHTML;
    }
    para(buf);
  };
  for (const n of [...root.childNodes]) {
    const tag = n.nodeName;
    if (n.nodeType === 3) { para(escHtml(n.textContent)); continue; }
    if (n.nodeType !== 1) continue;
    if (/^H[1-6]$/.test(tag)) {
      const level = Math.max(2, +tag[1]);
      blocks.push(`<!-- wp:heading${level === 2 ? '' : ` {"level":${level}}`} -->
<h${level} class="wp-block-heading">${n.innerHTML}</h${level}>
<!-- /wp:heading -->`);
    } else if (tag === 'UL' || tag === 'OL') {
      const items = [...n.children].filter(li => li.nodeName === 'LI').map(li => `<!-- wp:list-item -->
<li>${li.innerHTML}</li>
<!-- /wp:list-item -->`).join('\n');
      blocks.push(`<!-- wp:list${tag === 'OL' ? ' {"ordered":true}' : ''} -->
<${tag.toLowerCase()} class="wp-block-list">${items}</${tag.toLowerCase()}>
<!-- /wp:list -->`);
    } else if (tag === 'BLOCKQUOTE') {
      // "— Writer, Book" on the last line becomes the quote's citation
      const parts = n.innerHTML.split(/<br\s*\/?>/i);
      let cite = '';
      const last = (parts[parts.length - 1] || '').replace(/<[^>]+>/g, '').trim();
      if (/^[—–-]\s*\S/.test(last)) { cite = parts.pop().trim().replace(/^[—–-]\s*/, ''); }
      const inner = parts.join('<br>').replace(/(<br>)+$/, '').trim();
      blocks.push(`<!-- wp:quote -->
<blockquote class="wp-block-quote"><!-- wp:paragraph -->
<p>${inner}</p>
<!-- /wp:paragraph -->${cite ? `<cite>${cite}</cite>` : ''}</blockquote>
<!-- /wp:quote -->`);
    } else if (tag === 'HR') {
      blocks.push('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->');
    } else if (tag === 'PRE') {
      blocks.push(`<!-- wp:preformatted -->
<pre class="wp-block-preformatted">${n.innerHTML}</pre>
<!-- /wp:preformatted -->`);
    } else if (tag === 'IMG') {
      image(n.getAttribute('src') || '');
    } else if (n.querySelector('img')) {
      withImages(n);
    } else if (tag === 'DIV' && n.querySelector('p,h1,h2,h3,ul,ol,blockquote')) {
      blocks.push(...entryToWordPress(n.innerHTML, links).content.split('\n\n').filter(Boolean));   // nested block content
    } else {
      para(n.innerHTML);
    }
  }
  return { content: blocks.join('\n\n'), images };
}
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function postToWordPress() {
  const c = state.current;
  if (!c) return;
  saveNow();
  let st; try { st = await api.wpStatus(); } catch { st = { connected: false }; }
  if (!st.connected) { toast('Connect your WordPress site first'); openSettings('wordpress'); return; }
  const [rec, links] = await Promise.all([api.wpRecord(c.id).catch(() => null), api.wpLinks().catch(() => ({}))]);
  const conv = entryToWordPress(body.innerHTML, links);
  const title = titleIn.value.trim() || dateTitle(c.date);
  // the week's picture, as an option for the featured image
  let weekPic = null;
  try {
    const s = seasonOn(c.date), wk = s && window.WellWriteWeeks && window.WellWriteWeeks.weekOf(s);
    if (wk) { const info = await api.pictureInfo(wk.key); if (info && info.dataUrl) weekPic = { dataUrl: info.dataUrl, credit: info.credit }; }
  } catch {}
  const cat = catById(c.category);
  const catPathSlash = cat ? (catById(cat.parent) ? `${catById(cat.parent).name} / ${cat.name}` : cat.name) : '';
  return openDialog((f, done) => {
    const status = el('select', { id: 'wpStatus' }, el('option', { value: 'draft' }, 'Save as a draft'), el('option', { value: 'publish' }, 'Publish now'), el('option', { value: 'private' }, 'Publish privately (only you can see it)'));
    status.value = rec && rec.status && rec.status !== 'draft' ? rec.status : 'draft';
    const feat = el('select', { id: 'wpFeatured' },
      conv.images.length ? el('option', { value: 'first' }, 'The first photo in this entry') : null,
      weekPic ? el('option', { value: 'week' }, 'This week’s picture' + (weekPic.credit ? ` (${weekPic.credit.title})` : '')) : null,
      el('option', { value: 'none' }, 'No featured image'));
    feat.value = conv.images.length ? 'first' : 'none';
    const useDate = el('input', { type: 'checkbox', id: 'wpUseDate' }); useDate.checked = true;
    const catBox = el('input', { type: 'checkbox' }); catBox.checked = !!catPathSlash;
    const tagBox = el('input', { type: 'checkbox' }); tagBox.checked = (c.tags || []).length > 0;
    const go = el('button', { type: 'submit', class: 'btn-ink', id: 'wpGo' }, rec ? 'Update post' : 'Send to WordPress');
    const words = (body.innerText.trim().match(/\S+/g) || []).length;
    f.addEventListener('submit', async e => {
      e.preventDefault();
      go.disabled = true; go.textContent = conv.images.length ? 'Uploading photos…' : 'Sending…';
      try {
        const featured = feat.value === 'first' ? conv.images[0] : feat.value === 'week' ? weekPic.dataUrl : null;
        const r = await api.wpPublish(c.id, {
          title, content: conv.content, images: conv.images, featured, status: status.value,
          date: useDate.checked ? `${c.date}T${/^\d\d:\d\d$/.test(c.time || '') ? c.time : '09:00'}:00` : null,
          categories: catBox.checked && catPathSlash ? [catPathSlash] : [], tags: tagBox.checked ? (c.tags || []) : [],
          slugBase: title.toLowerCase(),
        });
        done();
        updateWpButton();
        toast(r.status === 'publish' ? 'Published on your site' : r.status === 'private' ? 'Posted privately' : 'Saved as a draft on your site');
        if (r.link && status.value !== 'draft') api.wpOpen(r.link);
      } catch (x) { toast(x.message); go.disabled = false; go.textContent = rec ? 'Update post' : 'Send to WordPress'; }
    });
    const row = (label, help, control) => el('div', { class: 'row' }, el('div', {}, label, help ? el('small', {}, help) : null), control);
    f.append(
      el('h2', {}, rec ? 'Update on WordPress' : 'Post to WordPress'),
      el('p', {}, `To ${st.site.replace(/^https?:\/\//, '')}. ${rec ? 'This updates the same post' + (rec.link ? '' : '') + '.' : 'Nothing else from your journal is sent.'}`),
      el('div', { class: 'wp-preview' }, el('b', {}, title), el('small', {}, `${words} words${conv.images.length ? ` · ${conv.images.length} photo${conv.images.length === 1 ? '' : 's'}` : ''} · headings, lists, quotes and links kept`)),
      row('Status', 'Drafts appear in WordPress for you to check before publishing.', status),
      row('Featured image', null, feat),
      row('Use the entry’s date', fmt(c.date, { day: 'numeric', month: 'long', year: 'numeric' }) + (c.date > todayISO() ? ' — a future date schedules the post' : ''), useDate),
      catPathSlash ? row('Category', catPathSlash + ' (created on your site if it’s not there)', catBox) : null,
      (c.tags || []).length ? row('Tags', (c.tags || []).map(t => '#' + t).join(' '), tagBox) : null,
      rec && rec.link ? el('p', {}, el('button', { type: 'button', class: 'btn-link', onclick: () => api.wpOpen(rec.link) }, 'View the post on your site')) : null,
      el('div', { class: 'btns' }, go, el('button', { type: 'button', class: 'btn-plain', onclick: () => done() }, 'Cancel')));
  });
}

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
  pop.className = 'popover';
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

// --- The writers: a short life, with their journey with God (renderer/authors.js)
const nameKey = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\b(saint|st)\b\.?/g, '').replace(/[^a-z]+/g, ' ').trim();
let authorIndex = null;
function authorBio(name) {
  const list = window.WellWriteAuthors || [];
  if (!authorIndex) {
    authorIndex = new Map();
    for (const b of list) for (const n of [b.name, ...(b.aliases || [])]) authorIndex.set(nameKey(n), b);
  }
  return authorIndex.get(nameKey(name)) || null;
}
/** A writer's name; where there's a biography, a link that opens it. */
function authorLink(name) {
  const b = authorBio(name);
  if (!b) return name || 'Unknown';
  return el('button', { type: 'button', class: 'author-link', title: `About ${b.name}`, onclick: e => { e.stopPropagation(); authorPopover(e.currentTarget, b); } }, name);
}
function authorPopover(anchor, b) {
  showPopover(anchor.getBoundingClientRect(), pop => {
    pop.classList.add('author-pop');
    pop.append(
      el('p', { class: 'ap-name' }, b.name),
      el('p', { class: 'ap-meta' }, [b.dates, b.tagline].filter(Boolean).join(' · ')),
      el('p', { class: 'ap-short' }, b.short),
      el('div', { class: 'ap-btns' },
        el('button', { type: 'button', class: 'btn-ink', id: 'authorMore', onclick: () => { closePopover(); openAuthorPage(b); } }, 'Read more'),
        el('button', { type: 'button', class: 'btn-link', onclick: () => closePopover() }, 'Close')));
    setTimeout(() => { const m = pop.querySelector('#authorMore'); if (m) m.focus(); });
  });
}
/** The fuller page about a writer, with an easy way back to the journal. */
function openAuthorPage(b) {
  const theirs = state.quotes.filter(q => authorBio(q.author) === b);
  return openDialog((f, done) => {
    f.classList.add('page', 'author-page');
    const back = label => el('button', { type: 'button', class: 'btn-plain back-journal', onclick: () => done() }, label);
    f.append(...[
      el('div', { class: 'ap-top' }, back('‹ Back to my journal')),
      el('article', { class: 'ap-article' }, ...[
        b.tagline ? el('p', { class: 'ap-eyebrow' }, b.tagline) : null,
        el('h2', {}, b.name),
        b.dates ? el('p', { class: 'ap-dates' }, b.dates) : null,
        ...String(b.long || b.short).split(/\n\s*\n/).map(par => el('p', { class: 'ap-body' }, par)),
        (b.read || []).length ? el('section', { class: 'ap-sec' }, el('h3', {}, 'To read next'), el('ul', {}, ...b.read.map(t => el('li', {}, el('i', {}, t))))) : null,
        theirs.length ? el('section', { class: 'ap-sec' }, el('h3', {}, `In your collection (${theirs.length})`),
          ...theirs.slice(0, 3).map(q => el('blockquote', { class: 'ap-quote' }, q.text))) : null,
        (b.sources || []).length ? el('section', { class: 'ap-sec ap-sources' }, el('h3', {}, 'Sources'),
          el('ul', {}, ...b.sources.map(src => el('li', {}, el('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.title))))) : null,
        el('div', { class: 'btns' }, back('Back to my journal')),
      ].filter(Boolean)),
    ].filter(Boolean));
    setTimeout(() => { const t = f.querySelector('.back-journal'); if (t) t.focus(); });
  });
}

// --- Bible version, changed from wherever a verse is shown
/** The version name under a verse ("WEB"), as a button that opens the list of versions. */
function versionButton(label) {
  return el('button', { type: 'button', class: 'version-btn', title: 'Change Bible version', onclick: e => versionMenu(e.currentTarget) }, el('cite', {}, label), ' ▾');
}
async function versionMenu(anchor) {
  try { state.bible = await api.bibleInfo(); } catch {}
  const b = state.bible;
  if (!b) return;
  showPopover(anchor.getBoundingClientRect(), pop => {
    pop.append(el('div', { class: 'menu-head' }, 'Bible version'));
    for (const [id, name] of Object.entries(b.translations)) {
      pop.append(el('button', { type: 'button', class: 'menu-item' + (b.state.translation === id ? ' on' : ''), onclick: async () => {
        closePopover();
        if (b.state.translation === id) return;
        await saveBible({ translation: id });
        refreshQuote();
        toast(`Now reading the ${name}`);
      } }, name));
    }
    pop.append(el('button', { type: 'button', class: 'menu-item subtle', onclick: () => { closePopover(); openSettings('bible'); } }, 'More versions in Settings…'));
  });
}

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
    setTimeout(() => focusTyping(input));
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
/** Connect your own WordPress site (an Application Password from Users → Profile). */
function wordpressControls(redraw) {
  const box = el('div', { class: 'readings-box', id: 'wordpressBox' });
  (async () => {
    let st; try { st = await api.wpStatus(); } catch { st = { connected: false }; }
    if (st.connected) {
      box.replaceChildren(el('div', { class: 'row' }, el('div', {}, `Connected to ${st.site.replace(/^https?:\/\//, '')}`,
        el('small', {}, `As ${st.name || st.user}. Use “Post to WordPress” at the bottom of any entry; posts are drafts unless you choose otherwise.`)),
        el('button', { type: 'button', class: 'btn-link danger', onclick: async () => { await api.wpForget(); updateWpButton(); redraw(); } }, 'Disconnect')));
      return;
    }
    const site = el('input', { type: 'text', id: 'wpSite', placeholder: 'yoursite.com', autocomplete: 'off', spellcheck: 'false' });
    const user = el('input', { type: 'text', id: 'wpUser', placeholder: 'WordPress username', autocomplete: 'off', spellcheck: 'false' });
    const pass = el('input', { type: 'password', id: 'wpPass', placeholder: 'Application password', autocomplete: 'off' });
    const go = el('button', { type: 'button', class: 'btn-plain', id: 'wpConnect', onclick: async () => {
      go.disabled = true; go.textContent = 'Checking…';
      try { const r = await api.wpConnect(site.value, user.value, pass.value); toast(`Connected to ${r.site.replace(/^https?:\/\//, '')}`); updateWpButton(); redraw(); }
      catch (e) { toast(e.message); go.disabled = false; go.textContent = 'Connect'; }
    } }, 'Connect');
    box.replaceChildren(
      el('p', {}, 'Post entries to your own WordPress site. In WordPress, go to Users → Profile → Application Passwords, type “WellWrite”, click Add, and paste the password it shows here. It’s kept encrypted on ' + HERE + '.'),
      el('div', { class: 'wp-fields' }, site, user, pass, go));
  })();
  return box;
}

/** Bible versions: the one used everywhere, and more versions from API.Bible with your own key. */
function bibleVersionControls(redraw) {
  const box = el('div', { class: 'readings-box', id: 'bibleVersions' });
  (async () => {
    let st; try { st = await api.apiBibleStatus(); } catch { st = { connected: false, versions: [] }; }
    try { state.bible = await api.bibleInfo(); } catch {}
    const b = state.bible;
    const tr = el('select', { id: 'bibleTr', 'aria-label': 'Bible version', onchange: async e => { await saveBible({ translation: e.target.value }); refreshQuote(); toast('Bible version changed'); } },
      ...Object.entries((b && b.translations) || {}).map(([id, name]) => el('option', { value: id }, name)));
    tr.value = (b && b.state.translation) || 'web';
    const rows = [el('div', { class: 'row' }, el('div', {}, 'Bible version', el('small', {}, 'Used for the verse of the day, the weekly pages and reading plans.')), tr)];
    if (!st.connected) {
      const key = el('input', { type: 'password', id: 'apiBibleKey', placeholder: 'Your API.Bible key', autocomplete: 'off', spellcheck: 'false' });
      const go = el('button', { type: 'button', class: 'btn-plain', id: 'apiBibleConnect', onclick: async () => {
        go.disabled = true; go.textContent = 'Checking…';
        try {
          await api.apiBibleSetKey(key.value);
          // Ready straight away: the popular English versions your key allows (more can be ticked in "Choose versions…").
          const list = await api.apiBibleList('eng').catch(() => []);
          const want = ['NIV', 'ESV', 'NLT', 'NKJV', 'NASB', 'CSB', 'BSB', 'NRSV', 'MSG', 'AMP', 'ASV', 'LSV', 'FBV'];
          const picks = want.map(a => list.find(b => (b.abbr || '').toUpperCase().replace(/\d+$/, '') === a)).filter(Boolean).slice(0, 8);
          if (picks.length) { await api.apiBibleSetVersions(picks); try { state.bible = await api.bibleInfo(); } catch {} }
          toast(picks.length ? `Connected: ${picks.map(b => b.abbr).join(', ')} added` : 'Connected to API.Bible');
          redraw();
          if (!picks.length) chooseBibleVersions(redraw);
        }
        catch (e) { toast(e.message); go.disabled = false; go.textContent = 'Connect'; }
      } }, 'Connect');
      rows.push(el('div', { class: 'row' }, el('div', {}, 'More versions from API.Bible',
        el('small', {}, 'Paste your free API.Bible key to add other translations (open translations, plus up to three copyrighted ones on the free plan). The key is kept encrypted on ' + HERE + '.')),
        el('div', { class: 'readings-btns' }, key, go)));
    } else {
      rows.push(el('div', { class: 'row' }, el('div', {}, 'API.Bible',
        el('small', {}, st.versions.length ? 'Added: ' + st.versions.map(v => v.abbr || v.name).join(', ') + '. Text is fetched as you read, so these need the internet.' : 'Connected. Choose the versions you want.')),
        el('div', { class: 'readings-btns' },
          el('button', { type: 'button', class: 'btn-plain', id: 'apiBibleChoose', onclick: () => chooseBibleVersions(redraw) }, 'Choose versions…'),
          el('button', { type: 'button', class: 'btn-link danger', onclick: async () => { await api.apiBibleForget(); try { state.bible = await api.bibleInfo(); } catch {} state.verseCache = {}; refreshQuote(); redraw(); } }, 'Disconnect'))));
    }
    box.replaceChildren(...rows);
  })();
  return box;
}
/** Pick versions from the ones your API.Bible key can use. */
async function chooseBibleVersions(back) {
  let list = [];
  const chosen = new Map(((await api.apiBibleStatus()).versions || []).map(v => [v.id, v]));
  return openDialog((f, done) => {
    f.classList.add('page');
    const lang = el('select', { 'aria-label': 'Language' }, ...[['eng', 'English'], ['', 'All languages']].map(([v, n]) => el('option', { value: v }, n)));
    const find = el('input', { type: 'text', placeholder: 'Search versions', id: 'bvFind' });
    const listBox = el('div', { class: 'bv-list' }, el('p', {}, 'Loading…'));
    const draw = () => {
      const q = find.value.trim().toLowerCase();
      const items = list.filter(b => !q || (b.name + ' ' + b.abbr + ' ' + b.language).toLowerCase().includes(q));
      listBox.replaceChildren(...items.slice(0, 400).map(b => {
        const cb = el('input', { type: 'checkbox', value: b.id }); cb.checked = chosen.has(b.id);
        cb.addEventListener('change', () => { if (cb.checked) chosen.set(b.id, b); else chosen.delete(b.id); });
        return el('label', { class: 'bv-row' }, cb, el('span', {}, el('b', {}, b.abbr || b.name), ' ', b.name, b.language && lang.value === '' ? el('small', {}, ' · ' + b.language) : null));
      }));
      if (!items.length) listBox.append(el('p', {}, list.length ? 'No versions match.' : 'No versions found.'));
    };
    const load = async () => {
      listBox.replaceChildren(el('p', {}, 'Loading…'));
      try { list = await api.apiBibleList(lang.value); draw(); } catch (e) { listBox.replaceChildren(el('p', {}, e.message)); }
    };
    lang.addEventListener('change', load); find.addEventListener('input', draw);
    f.addEventListener('submit', async e => {
      e.preventDefault();
      await api.apiBibleSetVersions([...chosen.values()]);
      try { state.bible = await api.bibleInfo(); } catch {}
      state.verseCache = {}; done(); refreshQuote(); toast(`${chosen.size} version${chosen.size === 1 ? '' : 's'} added`); if (back) back();
    });
    f.append(
      el('h2', {}, 'Bible versions from API.Bible'),
      el('p', {}, 'Tick the versions you want. They’ll appear alongside the World English Bible and King James Version. Copyrighted versions show their copyright notice wherever they’re used.'),
      el('div', { class: 'q-two' }, lang, find),
      listBox,
      el('div', { class: 'btns' }, el('button', { type: 'submit', class: 'btn-ink' }, 'Save'), el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); if (back) back(); } }, 'Cancel')));
    load();
  });
}

/** The two reading packs: built-in writing (on/off) and your readings file (choose / stop). */
function readingsControls(redraw = () => manageQuotes()) {
  const box = el('div', { class: 'readings-box' });
  const draw = () => {
    const packRows = (readings.packs || []).map(p => {
      const key = PACK_SETTING[p.id];
      const b = el('input', { type: 'checkbox', id: key || 'pack-' + p.id }); b.checked = packOn(p.id);
      if (key) b.addEventListener('change', async () => { await updateSetting({ [key]: b.checked }); await syncReadings(); redraw(); refreshQuote(); });
      else b.disabled = true;
      return el('div', { class: 'row' }, el('div', {}, p.name, el('small', {}, `${p.count} pieces that come with WellWrite. ${p.about || ''}`.trim())), b);
    });
    const pics = el('input', { type: 'checkbox', id: 'weekPictures' }); pics.checked = state.settings.weekPictures !== false;
    pics.addEventListener('change', async () => { await updateSetting({ weekPictures: pics.checked }); state.pictures = {}; pictureTried.clear(); refreshQuote(); });
    const f = readings.file;
    box.replaceChildren(
      ...packRows,
      el('div', { class: 'row' }, el('div', {}, 'A picture for each week',
        el('small', {}, 'Public-domain paintings and photographs, fetched once and kept in your journal. Change any week’s picture on its page.')), pics),
      el('div', { class: 'row' },
        el('div', {}, 'Your readings file',
          el('small', {}, !f ? 'Choose a text file of quotes once; WellWrite keeps your collection in step with it whenever it changes. Replacing the file replaces its readings — nothing doubles up.'
            : f.missing ? `Can’t find ${f.name} — it may have been moved. Choose it again.` : `${f.name}: ${f.count} readings, kept up to date.`)),
        el('div', { class: 'readings-btns' },
          el('button', { type: 'button', class: 'btn-plain', id: 'pickReadings', onclick: async () => {
            const p = await api.pickReadingsFile(); if (!p) return;
            const n = await syncReadings(); toast(`Readings loaded${n ? ` (${n} changes)` : ''}`); redraw(); refreshQuote();
          } }, f ? 'Change…' : 'Choose…'),
          f ? el('button', { type: 'button', class: 'btn-link danger', onclick: async () => {
            await api.forgetReadingsFile(); await api.syncReadings('file', []); state.quotes = await api.getQuotes(); readings.file = null;
            toast('Stopped using the readings file'); redraw(); refreshQuote();
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
  const O = (window.WellWriteSeasons && window.WellWriteSeasons.OCCASIONS) || {};
  const occ = el('select', { 'aria-label': 'Occasion', title: 'Only show this on a particular day or in a season' },
    el('option', { value: '' }, 'Any time of year'), ...Object.entries(O).map(([k, n]) => el('option', { value: k }, 'Only: ' + n)));
  occ.value = x.occasion || '';
  return {
    el: el('div', {}, el('div', { class: 'q-kind-row' }, kind, title, el('label', { class: 'q-mine' }, mine, ' My own writing')), el('div', { class: 'q-occ-row' }, occ)),
    get: () => ({ kind: kind.value, title: title.value.trim(), mine: mine.checked, occasion: occ.value }),
    reset: () => { kind.value = ''; title.value = ''; mine.checked = false; occ.value = ''; },
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
const readings = { file: null, packs: [] };
/** Built-in psalms and reflections count as "your" writing for the weekly Reflection, prayers and blessings. */
const ownish = q => q.mine || q.pack === 'wellwrite';
/** Each built-in collection has its own switch in Settings. */
const PACK_SETTING = { wellwrite: 'builtinReadings', classics: 'classicsReadings' };
const packOn = id => state.settings[PACK_SETTING[id]] !== false;
async function syncReadings({ quiet = true } = {}) {
  let changed = 0;
  try {
    const packs = await api.builtinReadings();
    readings.packs = packs.map(p => ({ id: p.id, name: p.name, about: p.about, count: p.items.length }));
    for (const p of packs) {
      const r = await api.syncReadings(p.id, packOn(p.id) ? p.items : [], p.retired);
      state.quotes = r.quotes; changed += r.added + r.updated + r.removed;
    }
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
/**
 * The year's readings, planned day by day so the whole collection is used:
 * each day takes the best-fitting quote for its season that hasn't been used yet this round,
 * avoiding the writer of the last few days; only when every quote has had a turn does a quote come round again.
 * The same plan picks the week's Reflection, prayer and blessing from your own writing.
 */
const yearPlans = new Map();   // `${year}|${plan}` -> { quotes: Map(iso → quote), weeks: Map(`${season}|${weekIndex}` → { reflection, prayer, blessing }) }
let yearPlanFor = null;        // the quotes array the plans were made from
function themeScore(q, season) {
  const n = season.themes.length; let score = 0;
  for (const t of q.themes || []) { const i = season.themes.indexOf(t); if (i >= 0) score += n - i; }
  return score;
}
/** Picks from a pool, round by round: best fit first among those not yet used this round. */
/**
 * A piece tied to an occasion (Good Friday, Lent, Christmas Day…) can only come then, and comes first then:
 * a day's own pieces before anything else, a season's pieces before general ones.
 */
const occasionsOn = iso => (window.WellWriteSeasons && window.WellWriteSeasons.occasionsOn ? window.WellWriteSeasons.occasionsOn(iso) : new Set());
const fitsOccasion = (q, occ) => !q.occasion || q.occasion === 'birthday' || occ.has(q.occasion);
const occasionBoost = (q, occ) => !q.occasion || !occ.has(q.occasion) ? 0 : window.WellWriteSeasons.DAY_OCCASIONS.has(q.occasion) ? 100000 : 5000;
/** Picks from a pool, round by round: best fit first among those not yet used this round. */
function roundRobin(pool, salt, { once = false } = {}) {
  const used = new Set();
  const pick = (season, occ, avoid) => {
    let best = null, bestScore = -Infinity;
    for (const q of pool) {
      if (used.has(q.id) || !fitsOccasion(q, occ)) continue;
      const sc = occasionBoost(q, occ) + themeScore(q, season) * 10 - avoid(q) + (strHash(q.id + salt) % 1000) / 1000;
      if (sc > bestScore) { best = q; bestScore = sc; }
    }
    return best;
  };
  return (season, avoid = () => 0, occ = new Set()) => {
    if (!pool.length) return null;
    let best = pick(season, occ, avoid);
    // When everything that fits today has had its turn, a new round begins — or early, if all that's left is
    // yesterday's writer (their remaining pieces simply come early in the next round).
    if (once && !best) return null;   // each piece once a year, no second round
    if (!best || (avoid(best) >= 200 && !best.occasion)) { used.clear(); best = pick(season, occ, avoid) || best; }
    if (best) used.add(best.id);
    return best;
  };
}
function yearPlan(year) {
  if (yearPlanFor !== state.quotes) { yearPlans.clear(); yearPlanFor = state.quotes; }
  const plan = quotePlan(), k = year + '|' + plan;
  if (yearPlans.has(k)) return yearPlans.get(k);
  const quotes = new Map(), weeks = new Map();
  const nextQuote = roundRobin(state.quotes.filter(isReading), 'q' + year);
  const isLong = q => ownish(q) && ['', 'reflection', 'fieldnote', 'psalm', 'poem'].includes(q.kind || '') && !isReading(q);
  const longs = state.quotes.filter(isLong);
  const nextReflection = roundRobin(longs.length ? longs : state.quotes.filter(q => ownish(q) && ['', 'reflection', 'fieldnote', 'psalm', 'poem'].includes(q.kind || '')), 'r' + year);
  const weekSeasons = new Map();   // week key → { season, occasions, number }
  const recent = [];
  for (let d = `${year}-01-01`; d.startsWith(String(year)); d = addDays(d, 1)) {
    const s = seasonOn(d);
    if (!s) break;
    const occ = occasionsOn(d);
    const q = nextQuote(s, x => (x.author === recent[recent.length - 1] ? 200 : recent.includes(x.author) ? 30 : 0), occ);
    if (q) { quotes.set(d, q); recent.push(q.author); if (recent.length > 3) recent.shift(); }
    const wk = window.WellWriteWeeks && window.WellWriteWeeks.weekOf(s);
    const wkKey = wk && `${s.id}|${wk.index}`;
    if (wk && !weeks.has(wkKey)) {
      // a week's own occasions: everything that falls on any of its days
      const wocc = new Set();
      for (let i = wk.firstDay - s.dayIndex; i <= wk.lastDay - s.dayIndex; i++) for (const o of occasionsOn(addDays(d, i))) wocc.add(o);
      weeks.set(wkKey, { reflection: nextReflection(s, undefined, wocc), prayer: null, blessing: null });
      weekSeasons.set(wkKey, { season: s, occ: wocc });
    }
  }
  // Your own prayers and blessings: each once a year, in the week that suits it best; the book's fill the other weeks.
  for (const [kind, slot] of [['prayer', 'prayer'], ['blessing', 'blessing']]) {
    const taken = new Set();
    for (const q of state.quotes.filter(x => ownish(x) && x.kind === kind)) {
      let best = null, bestScore = -Infinity;
      for (const [wkKey, w] of weekSeasons) {
        if (taken.has(wkKey) || !fitsOccasion(q, w.occ)) continue;
        const sc = occasionBoost(q, w.occ) + themeScore(q, w.season) * 10 + (strHash(q.id + wkKey + year) % 1000) / 1000;
        if (sc > bestScore) { best = wkKey; bestScore = sc; }
      }
      if (best) { taken.add(best); weeks.get(best)[slot] = q; }
    }
  }
  const out = { quotes, weeks };
  yearPlans.set(k, out);
  return out;
}

function quoteFor(iso) {
  const season = seasonOn(iso);
  if (season) {
    const skip = state.quoteSkip[iso] || 0;
    const planned = yearPlan(+iso.slice(0, 4)).quotes.get(iso);
    if (!skip && planned) return planned;
    // "Another": the season's best-fitting quotes in turn, never the day's own quote
    const occ = occasionsOn(iso);
    const pool = seasonPool(season).filter(q => isReading(q) && q !== planned && fitsOccasion(q, occ));
    if (pool.length >= 2) return pool[(season.dayIndex + skip - 1) % pool.length];
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
  const season = seasonOn(iso);
  return el('figure', { class: 'quote-card ' + where },
    season ? el('p', { class: 'q-season' }, `${season.name}, day ${season.dayIndex + 1}`) : null,
    el('blockquote', {}, q.text),
    el('figcaption', {}, '— ', authorLink(q.author), q.source ? ', ' : '', q.source ? el('cite', {}, q.source) : null),
    el('div', { class: 'q-actions' },
      btn('Write about this', () => writeAboutQuote(q, iso), 'q-btn primary'),
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
    el('figcaption', {}, '— ' + v.ref + ' ', versionButton(v.translation)),
    v.copyright ? el('p', { class: 'q-copy' }, v.copyright) : null,
    el('div', { class: 'q-actions' },
      btn('Write about this', () => writeAboutQuote({ text: v.text, author: v.ref, source: v.translation }, iso), 'q-btn primary'),
      btn(state.bible && state.bible.state.plan ? 'Today’s reading' : 'Reading plans', () => { state.bibleTab = 'plan'; setMode('bible'); }),
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
  if (!c) { slot.hidden = true; slot.replaceChildren(); return; }   // every entry shows the quote and verse for its own day
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
  m = l.match(/^occasion:\s*(.+)$/i);
  if (m) {
    const want = m[1].trim().toLowerCase().replace(/[’']/g, '');
    const O = (window.WellWriteSeasons && window.WellWriteSeasons.OCCASIONS) || {};
    const id = Object.keys(O).find(k => k === want || O[k].toLowerCase().replace(/[’']/g, '') === want);
    return id ? { occasion: id } : {};
  }
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
      ...(meta.kind ? { kind: meta.kind } : {}), ...(meta.title ? { title: meta.title } : {}), ...(meta.mine ? { mine: true } : {}), ...(meta.occasion ? { occasion: meta.occasion } : {}) });
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
        ...[['wellwrite', 'Chris Gribble’s writing'], ['classics', 'Classics of formation'], ['file', 'From your readings file']].map(([id, label]) => state.quotes.some(q => q.pack === id)
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
            x.title || x.kind || x.mine || x.occasion ? el('p', { class: 'q-kind' }, [x.kind ? KIND_NAMES[x.kind] : '', x.title, x.mine ? 'my own writing' : '',
              x.occasion && window.WellWriteSeasons ? 'only ' + window.WellWriteSeasons.OCCASIONS[x.occasion] : ''].filter(Boolean).join(' · ')) : null,
            el('p', { class: 'q-text' }, x.text),
            el('small', {}, authorLink(x.author), x.source ? `, ${x.source}` : ''),
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
    q.occasion && window.WellWriteSeasons ? 'Occasion: ' + window.WellWriteSeasons.OCCASIONS[q.occasion] : null,
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
  if (mode === 'journal') requestAnimationFrame(() => fitTitle());
  if (!['journal', 'bible', 'quote', 'photos'].includes(mode)) mode = 'journal';
  if (state.mode === 'journal' && mode !== 'journal') saveNow();
  state.mode = mode;
  try { localStorage.setItem('mode', mode); } catch {}
  $('#page').dataset.mode = mode;
  $('#topTitle').textContent = { journal: 'Journal', bible: 'Bible', quote: 'This week', photos: 'Photos' }[mode];
  for (const b of document.querySelectorAll('.modeswitch [data-mode], .tabbar [data-mode]')) {
    const on = b.dataset.mode === mode;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
  }
  $('#showAbove').hidden = mode !== 'journal';
  closePopover();
  if (mode === 'bible') renderBibleView();
  else if (mode === 'quote') renderQuoteView();
  else if (mode === 'photos') renderPhotosView();
  else if (state.current) renderQuoteSlot(); else showEmpty();
  $('#sheetScroll').scrollTop = 0;
}
for (const b of document.querySelectorAll('.modeswitch [data-mode], .tabbar [data-mode]')) b.addEventListener('click', () => { closeDrawer(); if (b.dataset.mode === state.mode && b.closest('.tabbar')) { $('#sheetScroll').scrollTo({ top: 0, behavior: 'smooth' }); return; } setMode(b.dataset.mode); });

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
/* ---------- the Bible tab: Read · Search · Plans ---------- */
const BIBLE_TABS = [['read', 'Read'], ['search', 'Search'], ['plan', 'Plans']];
function renderBibleView(opts = {}) {
  const view = $('#bibleView');
  if (!state.bibleTab) state.bibleTab = 'read';
  const bar = el('div', { class: 'bv-tabs', role: 'tablist', 'aria-label': 'Bible' }, ...BIBLE_TABS.map(([k, label]) =>
    el('button', { type: 'button', role: 'tab', class: 'bv-tab' + (state.bibleTab === k ? ' on' : ''), 'aria-selected': String(state.bibleTab === k), 'data-tab': k,
      onclick: () => { state.bibleTab = k; renderBibleView(); } }, label)));
  const body = el('div', { id: 'bibleBody', class: 'bv-body bv-' + state.bibleTab });
  view.replaceChildren(bar, body);
  if (state.bibleTab === 'read') return renderReader(body, opts);
  if (state.bibleTab === 'search') return renderBibleSearch(body);
  return renderPlanView(body);
}

// --- Read: any book and chapter, verse by verse
let bibleBooksList = null;
const readerStart = () => { try { const r = JSON.parse(localStorage.getItem('bibleRef') || 'null'); if (r && Number.isInteger(r.b) && Number.isInteger(r.c)) return r; } catch {} return { b: 18, c: 23 }; };
function setReaderPos(b, c) { state.readerPos = { b, c }; try { localStorage.setItem('bibleRef', JSON.stringify(state.readerPos)); } catch {} }
const bookShort = name => name.replace(/^Psalms$/, 'Psalm');

async function renderReader(body, { verse = 0, to = 0 } = {}) {
  const token = ++bibleToken;
  const pos = state.readerPos || (state.readerPos = readerStart());
  try { if (!bibleBooksList) bibleBooksList = await api.bibleBooks(); } catch { body.replaceChildren(el('p', { class: 'rv-note' }, 'The Bible could not be loaded.')); return; }
  const ch = await api.bibleChapter(bibleTr(), pos.b, pos.c).catch(() => null);
  if (token !== bibleToken) return;
  if (!ch) { setReaderPos(18, 23); return renderReader(body); }
  const books = bibleBooksList;
  const prev = pos.c > 1 ? { b: pos.b, c: pos.c - 1 } : pos.b > 0 ? { b: pos.b - 1, c: books[pos.b - 1].chapters } : null;
  const next = pos.c < books[pos.b].chapters ? { b: pos.b, c: pos.c + 1 } : pos.b < books.length - 1 ? { b: pos.b + 1, c: 1 } : null;
  const go = p => { setReaderPos(p.b, p.c); renderBibleView(); $('#bibleView').scrollTop = 0; $('#sheetScroll').scrollTop = 0; };
  const label = p => `${bookShort(books[p.b].name)} ${p.c}`;

  // verses, each tappable
  const selected = new Set();
  const text = el('article', { class: 'rd-text' + (state.readerSlide ? ' rd-in-' + state.readerSlide : '') });
  state.readerSlide = null;
  text.append(el('h2', { class: 'rd-title' }, label(pos)));
  // Swipe left for the next chapter, right for the one before (not from the screen's edges, which are Android's Back).
  let touch = null;
  text.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touch = e.touches.length === 1 && t.clientX > 28 && t.clientX < innerWidth - 28 ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  }, { passive: true });
  text.addEventListener('touchmove', e => {
    if (!touch) return;
    const dx = e.touches[0].clientX - touch.x, dy = e.touches[0].clientY - touch.y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5 && ((dx < 0 && next) || (dx > 0 && prev))) {
      text.style.transition = 'none'; text.style.transform = `translateX(${dx * 0.35}px)`; text.style.opacity = String(1 - Math.min(Math.abs(dx) / 600, .4));
    }
  }, { passive: true });
  text.addEventListener('touchend', e => {
    if (!touch) return;
    const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y, quick = Date.now() - touch.at < 800;
    touch = null;
    const swiped = quick && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8 && !String(getSelection()).trim();
    const to = swiped ? (dx < 0 ? next : prev) : null;
    if (to) { state.readerSlide = dx < 0 ? 'left' : 'right'; go(to); return; }
    text.style.transition = 'transform .2s, opacity .2s'; text.style.transform = ''; text.style.opacity = '';
  }, { passive: true });
  text.addEventListener('touchcancel', () => { touch = null; text.style.transform = ''; text.style.opacity = ''; });
  const verseText = new Map();
  for (const block of ch.blocks) {
    if (block[0] === 'h') { text.append(el('p', { class: 'rd-head' }, block[1])); continue; }
    if (block[0] === 'p') {
      const para = el('p', { class: 'rd-para' });
      for (const [v, t] of block[1]) { para.append(el('span', { class: 'rd-v', 'data-v': v }, el('sup', {}, String(v)), t + ' ')); verseText.set(v, (verseText.has(v) ? verseText.get(v) + ' ' : '') + t); }
      text.append(para);
    } else {
      const poem = el('div', { class: 'rd-poem' });
      let last = null;
      for (const [v, t] of block[1]) {
        poem.append(el('span', { class: 'rd-line rd-v', 'data-v': v }, v !== last ? el('sup', {}, String(v)) : null, t));
        verseText.set(v, (verseText.has(v) ? verseText.get(v) + '\n' : '') + t); last = v;
      }
      text.append(poem);
    }
  }
  const selBar = el('div', { class: 'rd-selbar', hidden: true });
  const refOf = vs => {
    const runs = [];
    for (const v of vs) { const r = runs[runs.length - 1]; if (r && v === r[1] + 1) r[1] = v; else runs.push([v, v]); }
    return `${label(pos)}:${runs.map(([a, b]) => (a === b ? a : `${a}–${b}`)).join(', ')}`;
  };
  const drawSel = () => {
    for (const n of text.querySelectorAll('.rd-v')) n.classList.toggle('sel', selected.has(+n.dataset.v));
    const vs = [...selected].sort((a, b) => a - b);
    selBar.hidden = !vs.length;
    if (!vs.length) return;
    const ref = refOf(vs), words = vs.map(v => verseText.get(v)).join(' ');
    selBar.replaceChildren(el('b', {}, ref),
      el('button', { type: 'button', class: 'btn-ink', onclick: () => writeAboutQuote({ text: words, author: ref, source: ch.translation }, todayISO()) }, 'Write about this'),
      el('button', { type: 'button', class: 'btn-plain', onclick: async () => {
        try { await navigator.clipboard.writeText(`${words}\n— ${ref} (${ch.translation})`); toast('Copied'); } catch { toast('Couldn’t copy'); }
      } }, 'Copy'),
      el('button', { type: 'button', class: 'btn-link', onclick: () => { selected.clear(); drawSel(); } }, 'Clear'));
  };
  text.addEventListener('click', e => {
    const n = e.target.closest('.rd-v'); if (!n) return;
    const v = +n.dataset.v; selected.has(v) ? selected.delete(v) : selected.add(v); drawSel();
  });

  body.replaceChildren(...[
    el('div', { class: 'rd-bar' },
      el('button', { type: 'button', class: 'rd-arrow', title: prev ? label(prev) : '', disabled: !prev, onclick: () => prev && go(prev) }, '‹'),
      el('button', { type: 'button', class: 'rd-ref', id: 'rdRef', onclick: () => bookPicker(pos, go) }, label(pos), el('span', { class: 'chev' }, ' ▾')),
      el('button', { type: 'button', class: 'rd-arrow', title: next ? label(next) : '', disabled: !next, onclick: () => next && go(next) }, '›'),
      el('span', { class: 'rd-gap' }),
      versionButton(ch.translation),
      el('button', { type: 'button', class: 'btn-plain rd-find', onclick: () => { state.bibleTab = 'search'; renderBibleView(); } }, 'Search')),
    ch.fallback ? el('p', { class: 'rv-note warn' }, `Couldn’t reach API.Bible (${ch.fallback}), so this is the World English Bible.`) : null,
    text,
    el('div', { class: 'rd-foot' },
      prev ? el('button', { type: 'button', class: 'btn-plain', onclick: () => go(prev) }, '‹ ' + label(prev)) : el('span'),
      next ? el('button', { type: 'button', class: 'btn-plain', onclick: () => go(next) }, label(next) + ' ›') : el('span')),
    el('p', { class: 'rv-note' }, (ch.copyright || `${ch.translation}, public domain. Tap a verse to copy it or write about it.`) + (TOUCH ? ' Swipe left or right for the next or previous chapter.' : '')),
    selBar,
  ].filter(Boolean));
  if (verse) {
    for (let v = verse; v <= (to || verse); v++) selected.add(v);
    drawSel();
    const n = text.querySelector(`.rd-v[data-v="${verse}"]`);
    if (n) requestAnimationFrame(() => { n.scrollIntoView({ block: 'center' }); n.classList.add('flash'); });
  }
}

/** Choose a book, then a chapter. */
function bookPicker(pos, go) {
  const books = bibleBooksList || [];
  return openDialog((f, done) => {
    f.classList.add('wide', 'book-picker');
    const find = el('input', { type: 'search', id: 'bpFind', placeholder: 'Find a book', 'aria-label': 'Find a book' });
    const grid = el('div', { class: 'bp-body' });
    const showBooks = () => {
      const q = find.value.trim().toLowerCase();
      const sec = (t, title) => {
        const list = books.map((b, i) => ({ ...b, i })).filter(b => b.testament === t && (!q || b.name.toLowerCase().includes(q)));
        return list.length ? [el('h3', {}, title), el('div', { class: 'bp-books' }, ...list.map(b =>
          el('button', { type: 'button', class: 'bp-book' + (b.i === pos.b ? ' on' : ''), onclick: () => showChapters(b.i) }, b.name)))] : [];
      };
      grid.replaceChildren(...sec('ot', 'Old Testament'), ...sec('nt', 'New Testament'));
    };
    const showChapters = bi => {
      const b = books[bi];
      if (b.chapters === 1) { done(); go({ b: bi, c: 1 }); return; }
      grid.replaceChildren(
        el('div', { class: 'bp-crumb' }, el('button', { type: 'button', class: 'btn-link', onclick: showBooks }, '‹ All books'), el('h3', {}, b.name)),
        el('div', { class: 'bp-chapters' }, ...Array.from({ length: b.chapters }, (_, k) =>
          el('button', { type: 'button', class: 'bp-ch' + (bi === pos.b && k + 1 === pos.c ? ' on' : ''), onclick: () => { done(); go({ b: bi, c: k + 1 }); } }, String(k + 1)))));
    };
    find.addEventListener('input', showBooks);
    find.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const first = grid.querySelector('.bp-book'); if (first) first.click(); } });
    f.append(el('div', { class: 'bp-head' }, el('h2', {}, 'Choose a passage'), find), grid,
      el('div', { class: 'btns' }, el('button', { type: 'button', class: 'btn-plain', onclick: () => done() }, 'Close')));
    showBooks();
    setTimeout(() => focusTyping(find));
  });
}

// --- Search: words, phrases in quotes, or a reference
const SEARCH_IDEAS = ['be still', 'peace', 'do not be afraid', '"love one another"', 'rest', 'Psalm 23', 'John 15', 'Romans 8:28'];
function renderBibleSearch(body) {
  const input = el('input', { type: 'search', id: 'bsFind', placeholder: 'Search words, “a phrase”, or a reference like Jn 3:16', 'aria-label': 'Search the Bible', value: state.bibleQuery || '' });
  const out = el('div', { class: 'bs-results' });
  let offset = 0, timer = 0, seq = 0;
  const open = (b, c, v, to) => { setReaderPos(b, c); state.bibleTab = 'read'; renderBibleView({ verse: v, to }); };
  const mark = (text, q) => {
    const words = q.replace(/"/g, ' ').split(/\s+/).filter(w => w.length > 1).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const span = el('span');
    if (!words.length) { span.textContent = text; return span; }
    const re = new RegExp(`(\\b(?:${words.map(w => (w.length < 4 ? `${w}\\b` : `${w}[a-z’']*`)).join('|')}))`, 'gi');
    let last = 0;
    for (const m of text.matchAll(re)) { span.append(text.slice(last, m.index), el('mark', {}, m[0])); last = m.index + m[0].length; }
    span.append(text.slice(last));
    return span;
  };
  const run = async (more = false) => {
    const q = input.value.trim();
    state.bibleQuery = q;
    const mine = ++seq;
    if (!more) offset = 0;
    if (q.length < 2) {
      out.replaceChildren(el('p', { class: 'bs-hint' }, 'Try:'), el('div', { class: 'bs-ideas' }, ...SEARCH_IDEAS.map(t =>
        el('button', { type: 'button', class: 'theme-chip', onclick: () => { input.value = t; run(); } }, t))));
      return;
    }
    const [ref, r] = await Promise.all([api.bibleParseRef(q).catch(() => null), api.bibleSearch(bibleTr(), q, offset).catch(e => ({ total: 0, results: [], error: e.message }))]);
    if (mine !== seq) return;
    const books = bibleBooksList || (bibleBooksList = await api.bibleBooks());
    const items = r.results.map(x => el('button', { type: 'button', class: 'bs-item', onclick: () => open(x.bookIndex, x.chapter, x.verse) },
      el('b', {}, x.ref), mark(x.text, q)));
    if (more) { out.querySelector('.bs-more')?.remove(); out.append(...items); }
    else out.replaceChildren(...[
      ref ? el('button', { type: 'button', class: 'bs-goto', onclick: () => open(ref.book, ref.chapter, ref.verse, ref.to) },
        el('span', {}, 'Go to'), el('b', {}, `${bookShort(books[ref.book].name)} ${ref.chapter}${ref.verse ? ':' + ref.verse + (ref.to ? '–' + ref.to : '') : ''}`), el('span', { class: 'chev' }, '›')) : null,
      r.fallback ? el('p', { class: 'rv-note warn' }, `Couldn’t search API.Bible (${r.fallback}); these results are from the World English Bible.`) : null,
      el('p', { class: 'bs-count' }, r.total ? `${r.total.toLocaleString()} verse${r.total === 1 ? '' : 's'}${r.translation ? ' in the ' + r.translation : ''}` : (ref ? '' : `No verses found for “${q}”. Try fewer words.`)),
      ...items,
    ].filter(Boolean));
    offset += r.results.length;
    if (offset < r.total) out.append(el('button', { type: 'button', class: 'btn-plain bs-more', onclick: () => run(true) }, `Show more (${(r.total - offset).toLocaleString()} left)`));
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => run(), 250); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); run(); } });
  body.replaceChildren(el('div', { class: 'bs-bar' }, input, versionButton(((state.bible && state.bible.translations[bibleTr()]) || 'WEB').replace(/^.*\((.+)\)$/, '$1').replace(/^World English Bible$/, 'WEB').replace(/^King James Version$/, 'KJV'))), out);
  run();
  setTimeout(() => { if (!TOUCH || !input.value) focusTyping(input, true); });
}

async function renderPlanView(box) {
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
      el('p', { class: 'rv-note' }, 'World English Bible: a modern translation in the public domain. King James Version: the 1769 text. Both are built in and work offline. Add more versions from API.Bible in Settings.'),
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
    r.fallback ? el('p', { class: 'rv-note warn' }, `Couldn’t reach API.Bible (${r.fallback}), so this is the World English Bible.`) : null,
    el('p', { class: 'rv-note' }, r.copyright ? r.copyright : `${b.translations[st.translation] || r.translation}, public domain.`),
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

/** A Bible passage: prose as a paragraph; poetry one line per line, long lines wrapping with a hanging indent. */
function verseParagraph(v) {
  const lines = v.text.split('\n');
  if (lines.length === 1) return el('p', {}, v.text);
  return el('p', { class: 'poetry' }, ...lines.map(l => el('span', { class: 'vl' }, l)));
}

// --- The weekly page, laid out like a devotional book
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const bibleTr = () => (state.bible && state.bible.state.translation) || 'web';

async function versesFor(refs) {
  const k = refs.join('|') + bibleTr();
  if (!state.verseCache[k]) state.verseCache[k] = await api.verses(refs, bibleTr());
  return state.verseCache[k];
}
/** The week's picture: { dataUrl, origin: 'default' | 'mine' | 'removed' | 'none', credit, hasDefault }. */
async function pictureFor(key) {
  if (!(key in state.pictures)) {
    try { state.pictures[key] = await api.pictureInfo(key); } catch { state.pictures[key] = { dataUrl: null, origin: 'none' }; }
  }
  return state.pictures[key];
}
/** Fetch WellWrite's picture for a week the first time it's shown (it is then kept in the journal). */
const pictureTried = new Set();
function fetchWeekPicture(key) {
  if (pictureTried.has(key) || state.settings.weekPictures === false) return;
  pictureTried.add(key);
  api.fetchDefaultPicture(key).then(ok => {
    if (!ok) return;
    delete state.pictures[key];
    if (state.mode === 'quote') renderQuoteView();
  }).catch(() => {});   // offline or unavailable: the "Add a picture" button stays, and it's tried again next time
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
      delete state.pictures[key];
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
  const [verses, blessing, pic] = await Promise.all([versesFor(week.verses), versesFor([week.blessing]), pictureFor(week.key)]);
  // With week pictures switched off, WellWrite's own pictures aren't shown (yours still are).
  const picture = state.settings.weekPictures === false && pic.origin === 'default' ? { ...pic, dataUrl: null, origin: 'none', credit: null } : pic;
  if (state.mode !== 'quote') return;
  if (!picture.dataUrl && picture.origin === 'none' && picture.hasDefault) fetchWeekPicture(week.key);
  const btn = (label, fn, cls = 'btn-plain', title) => el('button', { type: 'button', class: cls, onclick: fn, title }, label);
  const short = d => fmt(d, { day: 'numeric', month: 'short' });
  const goWeek = n => { state.weekAt = n < 0 ? addDays(days[0], -1) : addDays(days.at(-1), 1); renderQuoteView(); $('#quoteView').scrollTop = 0; };
  const sign = x => el('p', { class: 'wk-sign' }, authorLink(x.author), x.source ? ', ' : '', x.source ? el('cite', {}, x.source) : null);
  const shown = verses.filter(Boolean);
  // Your own writing: a reflection each week, and your prayers and blessings taking turns with the book's.
  const year = +days[0].slice(0, 4);
  // Planned across the year (see yearPlan), so each piece of your writing has its turn before any comes round again.
  const wp = yearPlan(year).weeks.get(`${s.id}|${week.index}`) || {};
  const reflection = wp.reflection || null;
  const myPrayer = wp.prayer || null;
  const myBlessing = wp.blessing || null;
  const kindHead = { psalm: 'A Psalm', poem: 'A Poem', reflection: 'A Reflection', fieldnote: 'From the field', '': 'A Reflection' };

  box.replaceChildren(el('article', { class: 'week-page' }, ...[
    el('nav', { class: 'wk-nav' },
      btn('‹ Previous week', () => goWeek(-1), 'btn-link'),
      !days.includes(today) ? btn('Back to this week', () => { state.weekAt = null; renderQuoteView(); }, 'btn-link') : el('span', {}, `${short(days[0])} – ${short(days.at(-1))}`),
      btn('Next week ›', () => goWeek(1), 'btn-link')),
    picture.dataUrl
      ? el('figure', { class: 'wk-picture' }, el('img', { src: picture.dataUrl, alt: picture.credit ? picture.credit.title : '' }),
        el('div', { class: 'wk-picture-tools' },
          btn(picture.origin === 'default' ? 'Use my own picture' : 'Change picture', () => choosePicture(week.key), 'pic-btn'),
          picture.origin === 'mine' && picture.hasDefault && state.settings.weekPictures !== false
            ? btn('Use WellWrite’s picture', async () => { await api.restoreDefaultPicture(week.key); delete state.pictures[week.key]; pictureTried.delete(week.key); renderQuoteView(); }, 'pic-btn') : null,
          btn('Remove', async () => { await api.removePicture(week.key); delete state.pictures[week.key]; renderQuoteView(); }, 'pic-btn')),
        picture.credit ? el('figcaption', { class: 'wk-credit' },
          el('i', {}, picture.credit.title), `, ${picture.credit.artist}${picture.credit.year ? ` (${picture.credit.year})` : ''} · ${picture.credit.licence}, Wikimedia Commons`) : null)
      : el('div', { class: 'wk-add-row' },
          btn('＋ Add a picture for this week', () => choosePicture(week.key), 'wk-add-picture', 'The picture comes back with this week each year'),
          picture.origin === 'removed' && picture.hasDefault && state.settings.weekPictures !== false
            ? btn('Use WellWrite’s picture', async () => { await api.restoreDefaultPicture(week.key); delete state.pictures[week.key]; pictureTried.delete(week.key); renderQuoteView(); }, 'btn-link small') : null),
    el('p', { class: 'wk-running' }, `Theme: ${s.name}`),
    el('div', { class: 'wk-head' },
      el('p', { class: 'wk-label' }, 'Week'),
      el('div', { class: 'wk-number' }, el('span', { class: 'wk-flourish', 'aria-hidden': 'true' }, '❧'), el('b', {}, String(week.number)), el('span', { class: 'wk-flourish flip', 'aria-hidden': 'true' }, '❧')),
      el('h2', { class: 'wk-title' }, week.title),
      el('p', { class: 'wk-about' }, `${s.about}. Week ${week.number} of ${week.weeks}.`)),
    el('hr', { class: 'wk-rule swash' }),
    shown.length ? el('section', { class: 'wk-scripture' },
      ...shown.map(verseParagraph),
      el('p', { class: 'wk-refs' }, '(' + shown.map(v => v.ref).join('; ') + ', ', versionButton(shown[0].translation), ')'),
      shown[0].copyright ? el('p', { class: 'wk-refs wk-copy' }, shown[0].copyright) : null) : null,
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
      : blessing[0] ? el('section', { class: 'wk-blessing' }, el('h4', {}, 'A Benediction'), verseParagraph(blessing[0]), el('p', { class: 'wk-refs' }, `${blessing[0].ref}, ${blessing[0].translation}`)) : null,
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
      el('figcaption', {}, '— ', authorLink(q.author), q.source ? ', ' : '', q.source ? el('cite', {}, q.source) : null),
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
  { k: 'pen', title: 'Write by hand', run: () => handwrite() },
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
// Blank lines are drawn short (see .caret-here in styles.css), except the one the cursor is on.
document.addEventListener('selectionchange', () => {
  const n = document.getSelection().anchorNode;
  let blk = n && body.contains(n) ? (n.nodeType === 1 ? n : n.parentElement) : null;
  while (blk && blk.parentElement !== body) blk = blk.parentElement;
  body.querySelectorAll('.caret-here').forEach(x => { if (x !== blk) { x.classList.remove('caret-here'); if (!x.classList.length) x.removeAttribute('class'); } });
  if (blk && blk !== body) blk.classList.add('caret-here');
});

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
  if (e.target.hasAttribute('data-ink')) { handwrite(e.target); return; }
  showPhoto({ src: e.target.src, img: e.target });
});
// On a touch screen a tap on a photo opens it (with Delete), instead of putting the cursor there and the keyboard up.
body.addEventListener('pointerdown', e => { if (TOUCH && e.target.tagName === 'IMG' && e.pointerType !== 'mouse') e.preventDefault(); });
body.addEventListener('click', e => {
  if (TOUCH && e.target.tagName === 'IMG' && e.target.hasAttribute('data-ink')) { e.preventDefault(); getSelection().removeAllRanges(); handwrite(e.target); return; }
  if (TOUCH && e.target.tagName === 'IMG') { e.preventDefault(); getSelection().removeAllRanges(); showPhoto({ src: e.target.src, img: e.target }); }
});

/* ---------- one photo, full size: go to its entry, or delete just that photo ---------- */
let shownPhoto = null;   // { src, img } from the open entry, or { src, entryId, index } from the Photos view
function showPhoto(p) {
  shownPhoto = p;
  const lb = $('#lightbox');
  lb.querySelector('img').src = p.src;
  $('#lbOpen').hidden = !p.entryId;
  lb.hidden = false;
}
function hidePhoto() { $('#lightbox').hidden = true; $('#lightbox img').removeAttribute('src'); shownPhoto = null; }
$('#lightbox').addEventListener('click', e => { if (!e.target.closest('.lb-bar')) hidePhoto(); });
$('#lbClose').onclick = hidePhoto;
$('#lbOpen').onclick = async () => {
  const p = shownPhoto; hidePhoto();
  await openEntry(p.entryId);
  const img = body.querySelectorAll(PHOTO)[p.index];
  if (img) img.scrollIntoView({ block: 'center' });
};
$('#lbDelete').onclick = async () => {
  const p = shownPhoto;
  if (!p) return;
  const ok = await confirmDialog({ title: 'Delete this photo?', text: 'Only this photo is removed. The rest of the entry stays as it is.', ok: 'Delete photo', danger: true });
  if (!ok) return;
  hidePhoto();
  try { await deletePhoto(p); toast('Photo deleted'); } catch (x) { toast('Couldn’t delete the photo: ' + x.message); }
};
/** Remove one photo from an entry: from the page if the entry is open, otherwise from the saved entry. */
async function deletePhoto(p) {
  const fromOpen = p.img ? p.img : (state.current && state.current.id === p.entryId && state.mode === 'journal' ? body.querySelectorAll(PHOTO)[p.index] : null);
  if (fromOpen && body.contains(fromOpen)) {
    const parent = fromOpen.parentElement;
    fromOpen.remove();
    if (parent && parent !== body && !parent.textContent.trim() && !parent.querySelector('img')) parent.remove();
    markDirty(); updateCounts(); await saveNow();
    return;
  }
  const e = await api.get(p.entryId);
  const doc = new DOMParser().parseFromString(clean(e.html), 'text/html');
  const img = doc.body.querySelectorAll(PHOTO)[p.index];
  if (!img) throw new Error('it has already gone');
  const parent = img.parentElement;
  img.remove();
  if (parent && parent !== doc.body && !parent.textContent.trim() && !parent.querySelector('img')) parent.remove();
  const meta = await api.save({ ...e, html: doc.body.innerHTML });
  state.metas = state.metas.map(m => (m.id === meta.id ? meta : m));
  renderSidebar();
  if (state.mode === 'photos') renderPhotosView();
}

/* ---------- photos ---------- */
const PHOTO = 'img:not([data-ink])';   // a handwritten page is a picture too, but not a photo
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

/* ---------- handwriting (ink.js): a page written with a pen, kept as a picture plus its strokes ---------- */
let handwriting = false;
/** Open the writing pad: for a new page at the cursor, or to carry on with a page already in the entry. */
async function handwrite(img = null) {
  if (handwriting) return;
  handwriting = true;
  try {
    if (!state.current) await newEntry(todayISO());
    const saved = getSelection().rangeCount && body.contains(getSelection().anchorNode) ? getSelection().getRangeAt(0).cloneRange() : null;
    const sel = getSelection();
    const range = img ? null : saved;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // the phone keyboard goes away while you write
    let r;
    try { r = await window.WellWriteInk.open(img ? img.getAttribute('data-ink') : null); }
    catch (x) { toast(x.message); return; }
    if (!r) return;
    if (r === 'delete') {
      if (!img || !body.contains(img)) return;
      const parent = img.parentElement; img.remove();
      if (parent && parent !== body && !parent.textContent.trim() && !parent.querySelector('img')) parent.remove();
      markDirty(); updateCounts(); toast('Handwritten page deleted');
      return;
    }
    if (img && body.contains(img)) { img.src = r.dataUrl; img.setAttribute('data-ink', r.ink); markDirty(); }
    else {
      body.focus();
      if (range) { sel.removeAllRanges(); sel.addRange(range); }
      else { const end = document.createRange(); end.selectNodeContents(body); end.collapse(false); sel.removeAllRanges(); sel.addRange(end); }
      exec('insertHTML', `<img src="${r.dataUrl}" data-ink="${r.ink}" alt="Handwritten page"><p><br></p>`);
    }
    updateCounts();
  } finally { handwriting = false; }
}

/* ---------- a photo journal: the camera, photos from the gallery, and every photo in one place ---------- */
/** Put the cursor at the end of the entry, so a new photo goes after what's there. */
function caretToEnd() {
  body.focus();
  const r = document.createRange(); r.selectNodeContents(body); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
/** The camera: the photo goes into today's entry (a new one if you're looking at another day), ready for a caption. */
$('#cameraBtn').addEventListener('click', () => $('#cameraFile').click());
$('#cameraTopBtn').addEventListener('click', () => $('#cameraFile').click());   // tablets held sideways
$('#cameraFile').addEventListener('change', async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  closeDrawer();
  const today = todayISO();
  const adding = state.mode === 'journal' && state.current && state.current.date === today;
  if (!adding) await newEntry(today);
  caretToEnd();
  await insertImages(files);
  markDirty();
  if (adding) toast('Photo added to today’s entry');
});
/** Photos from the gallery start a new entry, dated when the first one was taken. */
$('#galleryFile').addEventListener('change', async e => {
  const files = [...e.target.files].filter(f => f.type.startsWith('image/')); e.target.value = '';
  if (!files.length) return;
  const taken = await photoTakenAt(files[0]);
  await newEntry(taken ? taken.date : todayISO());
  if (taken && taken.time) { state.current.time = taken.time; renderStamp(); }
  caretToEnd();
  await insertImages(files);
  markDirty();
  if (taken && taken.date !== todayISO()) toast(`Dated ${fmt(taken.date, { day: 'numeric', month: 'long', year: 'numeric' })}, when the photo was taken`);
});

/** When a photo was taken, from its EXIF data: { date: 'YYYY-MM-DD', time: 'HH:MM' } or null. */
async function photoTakenAt(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 < v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) {   // "Exif"
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const u16 = p => v.getUint16(t + p, le), u32 = p => v.getUint32(t + p, le);
        const ascii = (p, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(t + p + i); if (!c) break; s += String.fromCharCode(c); } return s; };
        const tags = ifd => { const out = {}; const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; out[u16(e)] = { count: u32(e + 4), at: u32(e + 8) }; } return out; };
        const ifd0 = tags(u32(4));
        const exif = ifd0[0x8769] ? tags(ifd0[0x8769].at) : {};
        const d = exif[0x9003] || exif[0x9004] || ifd0[0x0132];
        const m = d && ascii(d.at, 19).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2})/);
        if (!m || +m[1] < 1990) return null;
        return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
      }
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      o += 2 + len;
    }
  } catch {}
  return null;
}

/** A small square-ish copy of a photo for the grid. */
function thumbOf(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 360 / Math.min(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
async function thumbsFor(m) {
  const key = `${m.id}:${m.updated || ''}:${m.images}`;
  if (state.photoThumbs.has(key)) return state.photoThumbs.get(key);
  const job = (async () => {
    const e = await api.get(m.id);
    const srcs = [...new DOMParser().parseFromString(clean(e.html), 'text/html').querySelectorAll(PHOTO)].map(i => i.getAttribute('src')).filter(Boolean);
    const out = [];
    for (const src of srcs) out.push(await thumbOf(src));
    return out;
  })();
  state.photoThumbs.set(key, job);
  job.catch(() => state.photoThumbs.delete(key));
  return job;
}

/** Every photo in the journal, newest first, by month. Tap one to open its entry at that photo. */
async function renderPhotosView() {
  const box = $('#photosView');
  await saveNow();
  const withPhotos = state.metas.filter(m => m.images > 0)
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  const total = withPhotos.reduce((a, m) => a + m.images, 0);
  const buttons = el('div', { class: 'btns' },
    ANDROID ? el('button', { type: 'button', class: 'btn-ink', onclick: () => $('#cameraFile').click() }, 'Take a photo') : null,
    el('button', { type: 'button', class: ANDROID ? 'btn-plain' : 'btn-ink', onclick: () => $('#galleryFile').click() }, ANDROID ? 'From your gallery' : 'Add photos'));
  const head = el('div', { class: 'ph-head' }, el('h2', {}, 'Photos'), buttons,
    total ? el('p', { class: 'ph-sub' }, `${total.toLocaleString()} photo${total === 1 ? '' : 's'} in ${withPhotos.length.toLocaleString()} entr${withPhotos.length === 1 ? 'y' : 'ies'}`) : null);
  if (!withPhotos.length) {
    box.replaceChildren(head, el('div', { class: 'ph-empty' },
      el('p', {}, ANDROID
        ? 'Take a photo with the camera button at the top and it goes straight into today’s entry, ready for a few words about it. Photos from your gallery start an entry on the day they were taken.'
        : 'Photos you add to entries appear here. Photos you add from here start an entry on the day they were taken.')));
    return;
  }
  const sections = [];
  let month = '', grid = null;
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      const tiles = en.target._tiles, m = en.target._meta;
      thumbsFor(m).then(th => tiles.forEach((t, i) => { if (th[i]) t.querySelector('img').src = th[i]; })).catch(() => {});
    }
  }, { root: $('#sheetScroll'), rootMargin: '600px 0px' });
  for (const m of withPhotos) {
    const mk = m.date.slice(0, 7);
    if (mk !== month) {
      month = mk;
      grid = el('div', { class: 'ph-grid' });
      sections.push(el('h3', { class: 'ph-month' }, fmt(m.date.slice(0, 7) + '-01', { month: 'long', year: 'numeric' })), grid);
    }
    const tiles = [];
    for (let i = 0; i < m.images; i++) {
      const t = el('button', { type: 'button', class: 'ph-tile', title: (m.title || dateTitle(m.date)), 'aria-label': `Photo ${i + 1} in ${m.title || dateTitle(m.date)}`,
        onclick: async () => {
          try {
            const e = await api.get(m.id);
            const src = [...new DOMParser().parseFromString(clean(e.html), 'text/html').querySelectorAll(PHOTO)][i];
            if (src) showPhoto({ src: src.getAttribute('src'), entryId: m.id, index: i });
          } catch (x) { toast(x.message); }
        } },
        el('img', { alt: '' }), i === 0 ? el('span', { class: 'ph-day' }, fmt(m.date, { day: 'numeric', month: 'short' })) : null);
      tiles.push(t); grid.append(t);
    }
    tiles[0]._tiles = tiles; tiles[0]._meta = m;
    io.observe(tiles[0]);
  }
  box.replaceChildren(head, ...sections);
}

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
  // On Windows the system follows this setting; on Android the page does it itself.
  if (['light', 'dark'].includes(s.theme)) document.documentElement.dataset.theme = s.theme; else delete document.documentElement.dataset.theme;
  if (typeof syncSystemBars === 'function') syncSystemBars();
  body.spellcheck = !!s.spellcheck;
}

async function updateSetting(patch) {
  state.settings = await api.setSettings({ ...state.settings, ...patch });
  applySettings();
}

/** The problems log, to read or copy and send. */
async function showProblemsLog() {
  const text = (await api.readLog().catch(() => '')) || 'Nothing has gone wrong yet.';
  await openDialog((f, done) => {
    f.classList.add('wide');
    const pre = el('pre', { class: 'log-text' }, text);
    f.append(el('h2', {}, 'Problems log'),
      el('p', {}, 'Copy this and send it to whoever looks after WellWrite for you. It has no journal text in it.'),
      pre,
      el('div', { class: 'actions' },
        ANDROID ? null : el('button', { type: 'button', class: 'btn-link', onclick: () => api.showLog() }, 'Show the file'),
        el('button', { type: 'button', class: 'btn-plain', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Selected: copy it from here'); } } }, 'Copy'),
        el('button', { type: 'button', class: 'btn-ink', onclick: () => done() }, 'Close')));
    setTimeout(() => { pre.scrollTop = pre.scrollHeight; });
  });
  openSettings('about');
}

/** Settings → What's new: every version from changelog.js. */
function whatsNew() {
  const sections = [['new', 'New'], ['improved', 'Improved'], ['fixed', 'Fixed']];
  return el('div', { class: 'whatsnew' }, ...(window.WellWriteChangelog || []).map(r => el('article', { class: 'wn-version' + (r.v === state.version ? ' current' : '') },
    el('header', {}, el('h3', {}, r.title), el('span', { class: 'wn-meta' }, `${r.v} · ${fmt(r.date, { day: 'numeric', month: 'long', year: 'numeric' })}`, r.v === state.version ? el('b', {}, ' · this version') : null)),
    ...sections.filter(([k]) => (r[k] || []).length).map(([k, label]) => el('div', { class: 'wn-part' },
      el('span', { class: 'wn-tag wn-' + k }, label), el('ul', {}, ...r[k].map(x => el('li', {}, x))))))));
}

/** Settings, as a page with tabs down the side: each area has its own place. */
const SETTINGS_TABS = [
  ['general', 'General'], ['readings', 'Quotes & readings'], ['bible', 'Bible'], ['privacy', 'Privacy & lock'],
  ['sync', 'Sync'], ['backups', 'Backups'], ['wordpress', 'WordPress'], ['about', 'About'], ['whatsnew', 'What’s new'],
];
function openSettings(section) {
  diag(`settings open ${section || ''} from ${caller()}`);
  let tab = SETTINGS_TABS.some(([k]) => k === section) ? section : (() => { try { return localStorage.getItem('settingsTab') || 'general'; } catch { return 'general'; } })();
  if (!SETTINGS_TABS.some(([k]) => k === tab)) tab = 'general';
  return openDialog((f, done) => {
    f.classList.add('page', 'settings-page');
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
    const panel = (key, title, intro, ...kids) => el('section', { class: 'set-panel', 'data-tab': key, id: 'set-' + key, hidden: key !== tab },
      el('h2', {}, title), intro ? el('p', { class: 'set-intro' }, intro) : null, ...kids.filter(k => k != null));

    const panels = [
      panel('general', 'General', null,
        el('div', { class: 'stat-line' },
          el('div', {}, el('b', {}, state.metas.length.toLocaleString()), 'entries'),
          el('div', {}, el('b', {}, totalWords.toLocaleString()), 'words'),
          el('div', {}, el('b', {}, photos.toLocaleString()), 'photos'),
          el('div', {}, el('b', {}, String(streak())), 'day streak')),
        since ? el('p', { style: 'margin-top:6px' }, `Writing since ${fmt(since, { day: 'numeric', month: 'long', year: 'numeric' })}.`) : null,
        el('h3', {}, 'Writing'),
        row('Theme', null, select(s.theme, [['system', ANDROID ? 'Match phone' : 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']], v => updateSetting({ theme: v }))),
        row('Text size', null, size),
        row('Check spelling', ANDROID ? 'Your keyboard’s spelling suggestions.' : 'Underlines misspelled words. Right-click for suggestions.', check(s.spellcheck, v => updateSetting({ spellcheck: v }))),
        row('Categories', 'Group entries into sections, like a notebook.', el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); manageCategories(); } }, 'Edit categories'))),

      panel('readings', 'Quotes & readings', 'The quote and question each day, your own writing for each week, and the week pictures.',
        row('Your quotes', 'Add, edit and theme quotes, and choose whether they follow the Christian year or a theme each month.', el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); manageQuotes(); } }, 'Your quotes')),
        row('Above your journal', ANDROID ? 'What appears at the top of each entry.' : 'What appears at the top of each entry. You can also change it with “Above journal” at the top right.', select(dailyChoice(), [['both', 'Quote and verse'], ['quote', 'Quote of the day'], ['verse', 'Verse of the day'], ['none', 'Nothing']], async v => { await updateSetting({ dailyCard: v, showQuote: true }); refreshQuote(); })),
        readingsControls(() => openSettings('readings'))),

      panel('bible', 'Bible', 'The version used for the verse of the day, the weekly pages and reading plans. You can also switch version from the ▾ under any verse.',
        bibleVersionControls(() => openSettings('bible')),
        row('Reading plans', 'Read through the Bible, the New Testament, the Gospels or the Psalms.', el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); state.bibleTab = 'plan'; setMode('bible'); } }, 'Open reading plans'))),

      panel('privacy', 'Privacy & lock', 'Your journal is encrypted with your password. When it locks, your writing is hidden.',
        row('Lock after inactivity', null, select(s.autoLockMinutes, [['1', '1 minute'], ['5', '5 minutes'], ['10', '10 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['0', 'Never']], v => updateSetting({ autoLockMinutes: +v }))),
        row('Remember my password', 'When WellWrite locks, your writing is hidden either way. With these, you open it again with one click.', trustSelect()),
        row(ANDROID ? 'Lock when I leave WellWrite' : 'Lock when minimised', ANDROID ? 'Locks whenever you switch to another app or the screen turns off.' : 'Also locks when Windows locks or the computer sleeps.', check(s.lockOnMinimize, v => updateSetting({ lockOnMinimize: v }))),
        row('Password', null, el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); changePassword(); } }, 'Change password'))),

      panel('sync', 'Sync between your devices', 'Keep your journal the same on your computer, phone and tablet, through your own Google Drive. Everything is encrypted with your journal password before it leaves this device.',
        el('div', { id: 'syncSection' }, el('p', {}, 'Checking…'))),

      panel('backups', 'Backups', 'Backups are encrypted with your password, so they are safe to keep online or on a USB drive.',
        ANDROID ? el('p', {}, 'Save a backup file now and then. Android lets you save it straight to Google Drive, OneDrive or your phone.') : el('div', { id: 'backupSection' }),
        el('h3', {}, 'Backup files'),
        el('div', { class: 'btns' },
          el('button', { type: 'button', class: 'btn-plain', onclick: doBackup }, 'Save a backup file'),
          el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); doImport(); } }, 'Import a backup file'),
          state.backup && state.backup.google.connected
            ? el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); restoreFromDrive('import'); } }, 'Restore from Google Drive') : null),
        el('h3', {}, 'A readable copy'),
        row('Export readable copy', 'Every entry as one web page you can open, print or keep. It isn’t encrypted.', el('button', { type: 'button', class: 'btn-plain', onclick: () => { done(); doExportReadable(); } }, 'Export')),
        ANDROID ? null : el('p', { class: 'path', style: 'margin-top:14px' }, 'Journal folder: ', state.dataDir, ' ',
          el('button', { type: 'button', class: 'btn-link', onclick: () => api.showDataFolder() }, 'Show folder'))),

      panel('wordpress', 'WordPress', 'Post entries to your own website. Nothing is sent unless you press “Post to WordPress” on an entry.',
        wordpressControls(() => openSettings('wordpress'))),

      panel('about', 'About', null,
        el('div', { class: 'row' }, el('div', {}, 'WellWrite ' + state.version, el('small', { id: 'updStatus' }, ANDROID ? 'New versions download on Wi-Fi by themselves; tap Update now and Android installs them. Your journal stays as it is.' : 'Updates install automatically when you restart.')),
          el('button', { type: 'button', class: 'btn-plain', onclick: checkUpdates }, 'Check for updates')),
        row('Problems log', 'If something goes wrong, this says what happened. It holds error messages only, never your entries.', el('button', { type: 'button', class: 'btn-plain', onclick: showProblemsLog }, 'Show log')),
        el('p', { class: 'set-intro' }, 'Bible texts: World English Bible and King James Version (public domain); other versions from API.Bible. Week pictures: public-domain works from Wikimedia Commons.')),

      panel('whatsnew', 'What’s new', 'Every version of WellWrite, newest first: what was added, improved and fixed.', whatsNew()),
    ];

    const nav = el('nav', { class: 'set-nav', role: 'tablist', 'aria-label': 'Settings' },
      el('div', { class: 'set-nav-head' }, el('p', { class: 'set-nav-title' }, 'Settings'),
        el('button', { type: 'button', class: 'set-close', 'aria-label': 'Close Settings', title: 'Close Settings', onpointerup: e => { e.preventDefault(); diag('settings ✕'); done(); }, onclick: () => done() }, '✕')),
      ...SETTINGS_TABS.map(([key, label]) => el('button', { type: 'button', role: 'tab', class: 'set-tab' + (key === tab ? ' on' : ''), 'data-tab': key, 'aria-selected': String(key === tab),
        onclick: () => show(key) }, label)),
      el('button', { type: 'button', class: 'btn-ink set-done', onclick: () => { diag('settings Done'); done(); } }, 'Done'));
    const content = el('div', { class: 'set-content' }, ...panels);
    const show = key => {
      tab = key;
      lay.classList.remove('at-list');
      try { localStorage.setItem('settingsTab', key); } catch {}
      for (const b of nav.querySelectorAll('.set-tab')) { const on = b.dataset.tab === key; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
      for (const p of panels) p.hidden = p.dataset.tab !== key;
      content.scrollTop = 0;
    };
    // Phones: a list of sections first (unless asked for one), each opening on its own with ‹ Settings to go back.
    const lay = el('div', { class: 'set-layout' + (matchMedia('(max-width: 720px), (pointer: coarse) and (max-width: 1024px)').matches && !section ? ' at-list' : '') }, nav, content);
    content.prepend(el('div', { class: 'set-top' },
      el('button', { type: 'button', class: 'btn-link set-back', 'data-back': '', onclick: () => { lay.classList.add('at-list'); } }, '‹ Settings'),
      el('button', { type: 'button', class: 'btn-ink btn-small', onclick: () => { diag('settings Done (section)'); done(); } }, 'Done')));
    f.append(lay);
    setTimeout(() => { const b = nav.querySelector('.set-tab.on'); if (b) b.focus({ focusVisible: false }); });
    renderBackupSection();
    refreshBackupInfo();
    renderSyncSection();
  });
}

function trustSelect() {
  const sel = el('select', { 'aria-label': 'Remember my password' },
    el('option', { value: 'ask' }, 'No, ask every time'),
    el('option', { value: 'hour' }, 'For an hour after I type it'),
    el('option', { value: 'trust' }, 'Always, on ' + HERE));
  api.status().then(st => {
    const t = st.trust || { mode: 'ask' };
    sel.value = t.active || t.mode === 'hour' ? t.mode : 'ask';
    if (!t.available) { sel.disabled = true; sel.title = ANDROID ? 'This phone can’t protect a saved password' : 'Windows can’t protect a saved password on this computer'; }
  }).catch(() => {});
  sel.addEventListener('change', async () => {
    const mode = sel.value;
    if (mode === 'trust') {
      const ok = await confirmDialog({
        title: ANDROID ? 'Trust this phone?' : 'Trust this computer?',
        text: ANDROID
          ? 'WellWrite will open without your password on this phone. Anyone who can unlock your phone could read your journal, so keep a screen lock on. Your password is still needed on any other device and to restore backups.'
          : 'WellWrite will open without your password whenever you’re signed in to Windows on this computer. Anyone who can use your Windows account could read your journal. Your password is still needed on any other computer and to restore backups.',
        ok: ANDROID ? 'Trust this phone' : 'Trust this computer',
      });
      if (!ok) { openSettings(); return; }
    }
    try {
      await api.setTrust(mode);
      toast({ ask: 'WellWrite will ask for your password every time', hour: 'No password needed for the next hour', trust: ANDROID ? 'This phone is trusted' : 'This computer is trusted' }[mode]);
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
    ready: ANDROID ? `Version ${r.version} is available.` : `Version ${r.version} is ready. Restart WellWrite to install it.`,
    downloading: `Downloading version ${r.version}. You'll be asked to restart when it's ready.`,
    latest: 'You have the latest version.',
    offline: "Couldn't reach the update server. Check your connection and try again.",
  }[r.status];
  if (r.status === 'ready') {
    showUpdate(r.version);
    // On the phone, the download is right here too.
    if (ANDROID && !out.parentNode.querySelector('.upd-get')) out.after(el('button', { type: 'button', class: 'btn-ink btn-small upd-get', style: 'margin-top:8px', onclick: () => $('#updateBtn').click() }, 'Update now'));
  }
}

function showUpdate(version) {
  state.updateReady = version;
  // Phones: a dot on the menu buttons, and the update at the top of the ⋯ menu.
  document.body.classList.add('update-ready');
  $('#updateText').textContent = ANDROID ? `WellWrite ${version} is ready.` : `WellWrite ${version} is ready to install.`;
  if (ANDROID) { $('#updateBtn').textContent = 'Update now'; if (api.prefetchUpdate) api.prefetchUpdate().catch(() => {}); }
  $('#updateBar').hidden = false;
}
$('#updateBtn').onclick = async () => {
  await saveNow();
  if (ANDROID) {
    $('#updateBtn').disabled = true;
    try { await api.installUpdate(); } catch (x) { toast(x.message); }
    $('#updateBtn').disabled = false;
    return;
  }
  $('#updateBtn').disabled = true; $('#updateBtn').textContent = 'Restarting…';
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
  if (ANDROID) { card.hidden = true; return; }
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
    state.backup = await whileSigningIn(() => api.googleConnect());
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

/* ---------- sync between devices (src/sync.js) ---------- */
state.sync = null;
function renderSyncState() {
  const s = state.sync, n = $('#syncState');
  n.hidden = !(s && s.on);
  if (n.hidden) return;
  n.textContent = s.busy ? 'Syncing…' : s.error ? 'Not synced' : 'Synced';
  n.title = s.error ? s.error : s.last ? 'Last synced ' + new Date(s.last).toLocaleString() : '';
  n.classList.toggle('sync-bad', !!s.error && !s.busy);
}
api.onSyncStatus(s => {
  const was = state.sync;
  state.sync = s; renderSyncState();
  if (s.error && s.code === 'reauth' && state.unlocked && !shownErrors.has('sync:' + s.error)) { shownErrors.add('sync:' + s.error); toast('Sync stopped: ' + s.error); }
  if ($('#dlg').open && $('#syncSection') && (!was || was.busy !== s.busy || was.error !== s.error || was.on !== s.on)) renderSyncSection();
});
api.onSyncChanged(async r => {
  if (!state.unlocked || !r) return;
  state.metas = await api.list();
  if (r.categories) { try { state.categories = await api.getCategories(); } catch {} }
  const c = state.current;
  if (c && c.saved && r.changed.includes(c.id) && !state.dirty) {
    if (state.metas.some(m => m.id === c.id)) { state.current = null; await openEntry(c.id, { keepMode: true }); }
    else { toast('This entry was deleted on another device'); state.current = null; await newEntry(); }
  }
  renderSidebar();
  if (r.copies && r.copies.length) toast(r.copies.length === 1
    ? 'An entry was changed on two devices. Both versions are kept: look for “(from another device)”.'
    : `${r.copies.length} entries were changed on two devices. Both versions are kept: look for “(from another device)”.`);
});
const ago = iso => {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? plural(Math.round(s / 60), 'minute') + ' ago' : s < 86400 ? plural(Math.round(s / 3600), 'hour') + ' ago' : new Date(iso).toLocaleString();
};
/** Settings → Sync. */
async function renderSyncSection() {
  const box = $('#syncSection');
  if (!box) return;
  let s;
  try { s = state.sync = await api.syncStatus(); } catch (x) { box.replaceChildren(el('p', {}, x.message)); return; }
  renderSyncState();
  const row = (label, help, control) => el('div', { class: 'row' }, el('div', { class: 'row-text' }, label, help ? el('small', {}, help) : null), el('span', { class: 'row-ctl' }, control));
  const btn = (text, cls, fn) => el('button', { type: 'button', class: cls, onclick: fn }, text);
  const how = el('div', { class: 'sync-how' },
    el('h3', {}, 'How it works'),
    el('ul', {},
      el('li', {}, 'Turn sync on here, then on each of your other devices, with the same Google account.'),
      el('li', {}, 'Changes go up a few seconds after you stop writing, and come down when WellWrite opens and every few minutes.'),
      el('li', {}, 'Deleting an entry deletes it everywhere. If you change the same entry on two devices before they sync, both versions are kept.'),
      el('li', {}, 'Your entries and categories sync. Quotes, settings and week pictures stay on each device.'),
      el('li', {}, 'Google only ever sees scrambled files, in a “WellWrite sync” folder. Nobody can read them without your password, not even Google.')));
  if (!s.available) { box.replaceChildren(el('p', {}, 'Sync uses Google Drive, which isn’t set up in this version of WellWrite.')); return; }
  if (!s.connected) {
    box.replaceChildren(
      row('Google Drive', 'Not connected. WellWrite can only see the files it puts in your Drive, never anything else.', btn('Connect Google Drive', 'btn-ink', syncConnect)),
      how);
    return;
  }
  if (!s.on) {
    box.replaceChildren(
      row('Google Drive', s.email || 'Connected', btn('Turn on sync', 'btn-ink', syncTurnOn)),
      how);
    return;
  }
  const line = s.busy ? 'Syncing…' : s.error ? 'Not synced: ' + s.error : s.last ? 'Last synced ' + ago(s.last) : 'Not synced yet';
  box.replaceChildren(
    row('Sync is on', `${s.email || 'Google Drive'} · ${plainEntries(s.count)} in sync`, btn('Turn off', 'btn-link', syncTurnOff)),
    row(el('span', { class: s.error && !s.busy ? 'sync-bad' : '' }, line), s.code === 'reauth' ? 'Connect Google Drive again to carry on.' : '',
      s.code === 'reauth' ? btn('Connect again', 'btn-ink', syncConnect) : btn(s.busy ? 'Syncing…' : 'Sync now', 'btn-plain', async () => { await saveNow(); api.syncNow().catch(x => toast(x.message)); })),
    how);
}
async function syncConnect() {
  const waiting = openDialog((f, done) => f.append(
    el('h2', {}, 'Sign in to Google'),
    el('p', {}, ANDROID
      ? 'Your browser has opened Google’s sign-in. Choose your account and allow WellWrite, then come back to WellWrite.'
      : 'Finish signing in in the browser window that just opened, then come back here.'),
    el('div', { class: 'actions' }, el('button', { type: 'button', class: 'btn-plain', autofocus: true, onclick: () => { api.googleCancel(); done(); } }, 'Cancel'))));
  let ok = false;
  try { await whileSigningIn(() => api.googleConnect()); ok = true; } catch (x) { if (!/cancel/i.test(x.message)) toast(x.message); }
  if ($('#dlg').open) $('#dlg').close();
  await waiting;
  state.backup = await api.backupInfo().catch(() => state.backup);
  openSettings('sync');
  if (ok) { const s = await api.syncStatus().catch(() => null); if (s && !s.on) syncTurnOn(); }
}
async function syncTurnOn() {
  if (!state.unlocked) { state.afterUnlock = syncTurnOn; toast('Unlock your journal, then sync turns on'); return; }
  await saveNow();
  const pw = await promptDialog({
    title: 'Turn on sync',
    text: 'Enter your WellWrite password. If you already use sync on another device, enter the password you use there. It locks your journal in Google Drive.',
    label: 'Password', type: 'password', ok: 'Turn on sync',
  });
  if (!pw) { openSettings('sync'); return; }
  const working = openDialog(f => f.append(el('h2', {}, 'Turning on sync…'), el('p', {}, 'Bringing your devices into step. The first time can take a minute if you have many photos.')));
  try {
    await api.syncEnable(pw);
    if ($('#dlg').open) $('#dlg').close(); await working;
    state.metas = await api.list();
    try { state.categories = await api.getCategories(); } catch {}
    renderSidebar();
    toast('Sync is on');
  } catch (x) {
    if ($('#dlg').open) $('#dlg').close(); await working;
    if (/locked/i.test(x.message)) { state.afterUnlock = syncTurnOn; toast('Unlock your journal, then sync turns on'); return; }
    await confirmDialog({ title: 'Sync isn’t on', text: x.message, ok: 'OK' });
  }
  openSettings('sync');
}
async function syncTurnOff() {
  const ok = await confirmDialog({ title: 'Turn off sync on this device?', text: 'This device stops syncing. Your journal stays here as it is, and what’s in your Google Drive stays there for your other devices.', ok: 'Turn off' });
  if (ok) { try { await api.syncDisable(); toast('Sync is off on this device'); } catch (x) { toast(x.message); } }
  openSettings('sync');
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
    try { await whileSigningIn(() => api.googleConnect()); } catch (x) { $('#dlg').close(); if (!/cancel/i.test(x.message)) toast(x.message); return; }
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
$('#settingsBtn').onclick = () => openSettings();
// Esc always closes the open dialog (Settings, Your quotes…), even if something inside it has the key.
window.addEventListener('keydown', e => {
  const dlg = $('#dlg');
  if (e.key !== 'Escape' || !dlg.open || !$('#popover').hidden || $('.ink-pad')) return;
  e.preventDefault();
  try { dlg.close(); } catch {}
  if (dlg.open) dlg.removeAttribute('open');
}, true);

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
    else if (k === '1' || k === '2' || k === '3' || k === '4') { e.preventDefault(); setMode(['journal', 'bible', 'quote', 'photos'][+k - 1]); }
  }
  if (e.key === 'Escape' && !$('#lightbox').hidden) hidePhoto();
}, true);

for (const ev of ['mousemove', 'keydown', 'mousedown', 'wheel', 'pointerdown', 'touchstart', 'input']) {
  window.addEventListener(ev, () => { state.lastActivity = Date.now(); }, { passive: true, capture: true });
}
setInterval(() => {
  const m = state.settings.autoLockMinutes;
  if (state.unlocked && m > 0 && Date.now() - state.lastActivity > m * 60000) lockNow({ auto: true });
}, 10000);

// Keep "today" correct if the app stays open past midnight.
let lastDay = todayISO();
setInterval(() => { if (state.unlocked && todayISO() !== lastDay) { lastDay = todayISO(); renderSidebar(); } }, 60000);

api.onFlush(() => saveNow());
api.onUpdateReady(showUpdate);
// Phones: how the download is going, on the update bar.
if (api.onUpdateProgress) api.onUpdateProgress(p => {
  if (!state.updateReady) return;
  // The bar is in the sidebar; the toast shows it wherever you are.
  const say = t => { $('#updateText').textContent = t; toast(t); };
  if (p.error) { say(p.error); $('#updateBtn').disabled = false; return; }
  if (p.downloading) { const pct = Math.round(p.progress * 100); if (pct % 10 === 0) say(`Downloading WellWrite ${state.updateReady}… ${pct}%`); }
  else if (p.ready) $('#updateText').textContent = `WellWrite ${state.updateReady} is ready.`;
  else if (p.permission) say('Turn on “Allow from this source”, then come back to WellWrite.');
  else if (p.installing) say('Tap Update when Android asks. Your journal stays as it is.');
});
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
    ready: ANDROID ? `WellWrite ${r.version} is available.` : `WellWrite ${r.version} is ready. Restart to install it.`,
    downloading: `Downloading WellWrite ${r.version}. You'll be asked to restart when it's ready.`,
    latest: `You have the latest version, WellWrite ${state.version}.`,
    offline: "Couldn't check for updates. Check your internet connection.",
  }[r.status]);
});
api.onLock(() => lockNow({ auto: true }));

// ---------- phones: the sidebar slides out from the menu button ----------
function closeDrawer() { document.body.classList.remove('drawer-open'); }

// ---------- phones: the top bar, the ⋯ menu, the keyboard and the Back button ----------
$('#newTopBtn').addEventListener('click', () => newEntry(todayISO()));
$('#moreBtn').addEventListener('click', () => {
  showPopover($('#moreBtn').getBoundingClientRect(), pop => {
    pop.classList.add('menu');
    const item = (label, fn, cls = '') => el('button', { type: 'button', class: 'menu-item ' + cls, onclick: () => { closePopover(); fn(); } }, label);
    const c = state.current, writing = state.mode === 'journal' && c && !$('#sheet').hidden;
    if (state.updateReady) pop.append(item(`Update to WellWrite ${state.updateReady}`, () => $('#updateBtn').click(), 'update'), el('hr'));
    if (writing) {
      pop.append(el('p', { class: 'menu-info' }, [$('#saveState').textContent, $('#wordCount').textContent].filter(Boolean).join(' · ')));
      pop.append(item('Write by hand', () => handwrite()));
      if (!$('#wpBtn').hidden) pop.append(item('Post to WordPress', () => $('#wpBtn').click()));
      pop.append(item('Delete this entry', () => $('#deleteBtn').click(), 'danger'), el('hr'));
    }
    if (state.mode === 'journal') {
      pop.append(el('p', { class: 'menu-info' }, 'Above your journal'));
      for (const [v, label] of [['both', 'Quote and verse'], ['quote', 'Quote of the day'], ['verse', 'Verse of the day'], ['none', 'Nothing, just the journal']])
        pop.append(el('button', { type: 'button', class: 'menu-item sub' + (dailyChoice() === v ? ' on' : ''),
          onclick: async () => { closePopover(); await updateSetting({ dailyCard: v, showQuote: true }); refreshQuote(); } }, label));
      pop.append(el('hr'));
    }
    pop.append(item('Settings', () => openSettings()), item('Lock journal', () => lockNow()));
  });
});
// While a box has the keyboard, the bottom bar steps aside; while writing an entry, the formatting buttons sit above the keyboard.
const typingBox = e => e && (e.isContentEditable || e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && !/^(checkbox|radio|range|button|submit|file|color)$/.test(e.type)));
// The keyboard is up when the screen gets noticeably shorter than it is without it (same width).
let fullHeight = { w: innerWidth, h: innerHeight };
let keyboardUp = false;
function syncTyping() {
  const a = document.activeElement;
  document.body.classList.toggle('keyboard', TOUCH && keyboardUp);
  document.body.classList.toggle('writing', TOUCH && keyboardUp && a === body);
}
window.addEventListener('resize', () => {
  if (innerWidth !== fullHeight.w) fullHeight = { w: innerWidth, h: innerHeight };   // turned the phone
  fullHeight.h = Math.max(fullHeight.h, innerHeight);
  const was = keyboardUp;
  keyboardUp = innerHeight < fullHeight.h - 120;
  // Keyboard put away (Back, or its own button): stop typing, so the bottom bar comes back.
  if (was && !keyboardUp && TOUCH && typingBox(document.activeElement)) document.activeElement.blur();
  syncTyping();
});
document.addEventListener('focusin', syncTyping);
document.addEventListener('focusout', () => setTimeout(syncTyping, 120));   // a tap on a formatting button keeps the cursor
// Back: from the Bible, the week or the photos, back to the journal (after dialogs, menus and the sidebar close).
if (api.onBack) api.onBack(() => {
  const sel = document.querySelector('.rd-selbar:not([hidden]) .btn-link');   // chosen verses: clear them first
  if (sel && state.mode === 'bible') { sel.click(); return true; }
  if (state.unlocked && state.mode !== 'journal') { setMode('journal'); return true; }
  return false;
});
/** The phone's status and navigation bars take the colour of what's behind them. */
function syncSystemBars() {
  if (!api.systemBars) return;
  const locked = !$('#lock').hidden;
  let color = getComputedStyle(locked ? $('#lock') : $('#page')).backgroundColor;
  if (/rgba\(.*,\s*0\)$|transparent/.test(color)) color = getComputedStyle(document.body).backgroundColor;
  const [r, g, b] = (color.match(/\d+/g) || [255, 255, 255]).map(Number);
  api.systemBars({ color: '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join(''), light: (r * 299 + g * 587 + b * 114) / 1000 > 140 }).catch(() => {});
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => syncSystemBars());
// Phones stay open for days: look for a new version when you come back to WellWrite (at most once an hour).
let lastUpdateCheck = Date.now();
document.addEventListener('visibilitychange', () => {
  if (!ANDROID || document.hidden || state.updateReady || Date.now() - lastUpdateCheck < 3600e3) return;
  lastUpdateCheck = Date.now();
  api.checkUpdates().then(r => { if (r && r.status === 'ready') showUpdate(r.version); }).catch(() => {});
});
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
$('#scrim').addEventListener('click', closeDrawer);
// Opening something from the sidebar shows it.
$('.cloth').addEventListener('click', e => {
  if (e.target.closest('#list button, #list a, .cal-grid button, #newBtn, #onThisDay, #settingsBtn, #lockBtn, .ae-open, [data-open-all]')) setTimeout(closeDrawer, 0);
});
window.addEventListener('blur', () => saveNow());

boot();
