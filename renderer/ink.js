'use strict';
// Handwriting: a page you write on with a pen (or a finger or mouse), kept in an entry as a picture of the page
// plus the pen strokes themselves. The strokes keep every point's position, pressure and timing, so the page can
// be re-opened and added to, and later turned into typed text.
//
// Stored on the entry's <img> as data-ink="v1:<base64 of deflated JSON>", where the JSON is
//   { v: 1, w: 1000, h, at, s: [stroke…] }
// w, h: the page size in page units (always 1000 wide); at: when writing began (ms since 1970).
// Each stroke is a flat array: [colour, size, start, x, y, p, dx, dy, dp, dt, dx, dy, dp, dt, …]
// colour: index into COLOURS; size: pen width in page units; start: ms after `at`;
// x, y: tenths of a page unit; p: pressure 0–100; then each next point as differences from the one before,
// dt in ms. A stroke from the eraser is never stored; erasing removes whole strokes.
(() => {
  const W = 1000;                 // page width, in page units
  const LINE = 50, TOP = 110;     // ruled lines: spacing and first line
  const PAGE = 1300, MORE = 650;  // starting page height, and how much is added when you near the bottom
  const COLOURS = ['#1f2430', '#1f4fa8', '#b3261e', '#2e7d4f'];
  const COLOUR_NAMES = ['Black', 'Blue', 'Red', 'Green'];
  const SIZES = [3, 5, 8];
  const SIZE_NAMES = ['Fine', 'Medium', 'Bold'];
  const PAPER = '#fbfaf4', RULE = '#dfe3ea', MARGIN = '#efc9c4';
  const PREFIX = 'v1:';

  /* ---------- storing ---------- */
  async function deflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  async function inflate(bytes) {
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  /** strokes: [{ c, s, t0, pts: [{x, y, p, t}] }] → the data-ink text. */
  async function encode(page) {
    const s = page.strokes.filter(k => k.pts.length).map(k => {
      const a = [k.c, k.s, Math.max(0, Math.round(k.pts[0].t - page.at))];
      let px = 0, py = 0, pp = 0, pt = k.pts[0].t;
      k.pts.forEach((q, i) => {
        const x = Math.round(q.x * 10), y = Math.round(q.y * 10), p = Math.round(q.p * 100);
        if (i === 0) a.push(x, y, p); else a.push(x - px, y - py, p - pp, Math.max(0, Math.round(q.t - pt)));
        px = x; py = y; pp = p; pt = q.t;
      });
      return a;
    });
    const json = JSON.stringify({ v: 1, w: W, h: Math.round(page.h), at: Math.round(page.at), s });
    return PREFIX + toB64(await deflate(new TextEncoder().encode(json)));
  }

  /** The data-ink text → { h, at, strokes }; throws if it isn't handwriting WellWrite can read. */
  async function decode(text) {
    if (!String(text).startsWith(PREFIX)) throw new Error('Unknown handwriting format');
    const d = JSON.parse(new TextDecoder().decode(await inflate(fromB64(text.slice(PREFIX.length)))));
    if (d.v !== 1 || !Array.isArray(d.s)) throw new Error('Unknown handwriting format');
    const strokes = d.s.map(a => {
      const k = { c: a[0] | 0, s: +a[1] || SIZES[1], pts: [] };
      let x = a[3], y = a[4], p = a[5], t = d.at + a[2];
      k.pts.push({ x: x / 10, y: y / 10, p: p / 100, t });
      for (let i = 6; i + 3 < a.length + 0; i += 4) {
        x += a[i]; y += a[i + 1]; p += a[i + 2]; t += a[i + 3];
        k.pts.push({ x: x / 10, y: y / 10, p: p / 100, t });
      }
      return k;
    });
    return { h: Math.max(PAGE, +d.h || PAGE), at: +d.at || Date.now(), strokes };
  }

  /* ---------- drawing ---------- */
  function paper(ctx, h) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, h);
    ctx.strokeStyle = RULE; ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let y = TOP; y < h - 10; y += LINE) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = MARGIN; ctx.beginPath(); ctx.moveTo(70, 0); ctx.lineTo(70, h); ctx.stroke();
  }
  const width = (k, p) => k.s * (0.35 + 0.9 * p);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 });
  /** Draw a stroke's points from index `from` on (smoothed through the midpoints). */
  function drawStroke(ctx, k, from = 0) {
    const pts = k.pts;
    ctx.strokeStyle = ctx.fillStyle = COLOURS[k.c] || COLOURS[0];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (pts.length === 1 || (pts.length === 2 && from === 0 && Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < 0.5)) {
      ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, width(k, pts[0].p) / 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    for (let i = Math.max(1, from); i < pts.length; i++) {
      const a = i === 1 ? pts[0] : mid(pts[i - 2], pts[i - 1]);
      const b = mid(pts[i - 1], pts[i]);
      ctx.lineWidth = width(k, pts[i - 1].p);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, b.x, b.y); ctx.stroke();
    }
  }
  /** How far down the page the writing goes. */
  const inkBottom = strokes => strokes.reduce((m, k) => k.pts.reduce((n, q) => Math.max(n, q.y + k.s), m), 0);

  /** A picture of the page, cropped below the last line of writing. */
  function picture(page) {
    const h = Math.max(TOP + LINE * 3, Math.min(page.h, Math.ceil((inkBottom(page.strokes) + LINE) / LINE) * LINE + 20));
    const scale = 1.5;
    const c = document.createElement('canvas');
    c.width = W * scale; c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    paper(ctx, h);
    page.strokes.forEach(k => drawStroke(ctx, k));
    return c.toDataURL('image/png');
  }

  /* ---------- the writing pad ---------- */
  let penSeen = false;
  try { penSeen = localStorage.getItem('wellwrite.penSeen') === '1'; } catch {}
  const svg = d => `<svg viewBox="0 0 20 20" aria-hidden="true">${d}</svg>`;
  const IC = {
    pen: svg('<path d="M4 16l1-4 8.5-8.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L8 15z"/><path d="M12 5l3 3"/>'),
    eraser: svg('<path d="M8.5 16.5h8"/><path d="M3.8 12.2l7.5-7.5a1.5 1.5 0 0 1 2.1 0l2.9 2.9a1.5 1.5 0 0 1 0 2.1l-6.9 6.8H7.6l-3.8-3.7a1.1 1.1 0 0 1 0-.6z"/><path d="M7.6 8.4l5 5"/>'),
    undo: svg('<path d="M7 5L3.5 8.5 7 12"/><path d="M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9"/>'),
    redo: svg('<path d="M13 5l3.5 3.5L13 12"/><path d="M16 8.5H8.5a4.5 4.5 0 0 0 0 9H11"/>'),
  };

  /**
   * Open the pad. existing: data-ink text of a page to carry on with, or null for a new page.
   * Resolves { dataUrl, ink } when you press Done, 'delete' if you delete the page, or null if you cancel.
   */
  function open(existing) {
    return new Promise(async resolve => {
      let page;
      try { page = existing ? await decode(existing) : null; }
      catch { resolve(null); throw new Error('This handwriting can’t be opened'); }
      if (!page) page = { h: PAGE, at: Date.now(), strokes: [] };
      const undoStack = [], redoStack = [];
      let colour = 0, size = 1, erasing = false, changed = false;

      const el = (tag, attrs = {}, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) { if (k === 'html') n.innerHTML = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null && v !== false) n.setAttribute(k, v); }
        n.append(...kids.filter(k => k != null));
        return n;
      };
      const tool = (label, html, onclick, extra = {}) => el('button', { type: 'button', class: 'ink-btn', title: label, 'aria-label': label, html, onclick, ...extra });

      const swatches = COLOURS.map((c, i) => el('button', { type: 'button', class: 'ink-swatch', title: COLOUR_NAMES[i], 'aria-label': COLOUR_NAMES[i] + ' ink', style: `--c:${c}`, onclick: () => { colour = i; setErase(false); sync(); } }));
      const sizes = SIZES.map((s, i) => el('button', { type: 'button', class: 'ink-size', title: SIZE_NAMES[i], 'aria-label': SIZE_NAMES[i] + ' pen', onclick: () => { size = i; setErase(false); sync(); } }, el('span', { style: `width:${s + 3}px;height:${s + 3}px` })));
      const penBtn = tool('Pen', IC.pen, () => { setErase(false); sync(); });
      const eraseBtn = tool('Eraser: touch a stroke to remove it', IC.eraser, () => { setErase(!erasing); sync(); });
      const undoBtn = tool('Undo', IC.undo, undo);
      const redoBtn = tool('Redo', IC.redo, redo);
      const clearBtn = el('button', { type: 'button', class: 'ink-text', onclick: clearAll }, 'Clear');
      const hint = el('span', { class: 'ink-hint' });
      const canvas = el('canvas', { class: 'ink-canvas', 'aria-label': 'Handwriting page' });
      const sheet = el('div', { class: 'ink-sheet' }, canvas);
      const scroller = el('div', { class: 'ink-scroll' }, sheet);
      const overlay = el('div', { class: 'ink-pad', role: 'dialog', 'aria-label': 'Write by hand' },
        el('div', { class: 'ink-bar' },
          el('div', { class: 'ink-group' }, penBtn, eraseBtn),
          el('div', { class: 'ink-group' }, ...swatches),
          el('div', { class: 'ink-group' }, ...sizes),
          el('div', { class: 'ink-group' }, undoBtn, redoBtn, clearBtn),
          hint,
          el('div', { class: 'ink-group ink-end' },
            existing ? el('button', { type: 'button', class: 'ink-text danger', onclick: () => finish('delete') }, 'Delete page') : null,
            el('button', { type: 'button', class: 'btn-plain', onclick: () => finish(null) }, 'Cancel'),
            el('button', { type: 'button', class: 'btn-ink', onclick: () => finish('done') }, 'Done'))),
        scroller);
      document.body.append(overlay);

      function setErase(on) { erasing = on; }
      function sync() {
        penBtn.classList.toggle('on', !erasing); eraseBtn.classList.toggle('on', erasing);
        swatches.forEach((b, i) => b.classList.toggle('on', i === colour && !erasing));
        sizes.forEach((b, i) => b.classList.toggle('on', i === size && !erasing));
        undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length;
        clearBtn.disabled = !page.strokes.length;
        hint.textContent = penSeen ? 'Write with your pen · scroll with a finger' : 'Write with a pen, finger or mouse · two fingers to scroll';
      }

      // ---- sizing: the page fills the width; drawing is in page units ----
      let scale = 1;
      const ctx = canvas.getContext('2d');
      function layout() {
        const cssW = Math.max(300, Math.min(scroller.clientWidth - 24, 1100));
        scale = cssW / W;
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = cssW + 'px'; canvas.style.height = Math.round(page.h * scale) + 'px';
        canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(page.h * scale * dpr);
        redraw();
      }
      function redraw() {
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
        paper(ctx, page.h);
        page.strokes.forEach(k => drawStroke(ctx, k));
      }
      function growIfNeeded(y) {
        if (y > page.h - 250) { page.h += MORE; layout(); }
      }
      const ro = new ResizeObserver(() => layout());
      ro.observe(scroller);

      // ---- undo ----
      function record(action) { undoStack.push(action); redoStack.length = 0; changed = true; sync(); }
      function undo() {
        const a = undoStack.pop(); if (!a) return;
        if (a.add) page.strokes.splice(page.strokes.indexOf(a.add), 1);
        if (a.removed) a.removed.forEach(([k, i]) => page.strokes.splice(i, 0, k));
        if (a.cleared) page.strokes = a.cleared.slice();
        redoStack.push(a); changed = true; redraw(); sync();
      }
      function redo() {
        const a = redoStack.pop(); if (!a) return;
        if (a.add) page.strokes.push(a.add);
        if (a.removed) a.removed.slice().reverse().forEach(([k]) => page.strokes.splice(page.strokes.indexOf(k), 1));
        if (a.cleared) page.strokes = [];
        undoStack.push(a); changed = true; redraw(); sync();
      }
      function clearAll() {
        if (!page.strokes.length) return;
        record({ cleared: page.strokes.slice() }); page.strokes = []; redraw(); sync();
      }

      // ---- pointers ----
      let current = null;          // { id, stroke } while writing
      let erase = null;            // { id, removed: [[stroke, index]] } while erasing
      const touches = new Map();   // finger id → last y, for scrolling
      const at = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
      const pressure = e => e.pointerType === 'pen' ? Math.min(1, Math.max(0.05, e.pressure || 0.5)) : 0.5;
      const isEraserEnd = e => e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));

      function eraseAt(q) {
        const r = 10;
        for (let i = page.strokes.length - 1; i >= 0; i--) {
          const k = page.strokes[i];
          if (k.pts.some(p => Math.hypot(p.x - q.x, p.y - q.y) < r + k.s)) {
            erase.removed.push([k, i]); page.strokes.splice(i, 1); redraw();
          }
        }
      }

      canvas.addEventListener('pointerdown', e => {
        if (e.pointerType === 'pen' && !penSeen) { penSeen = true; try { localStorage.setItem('wellwrite.penSeen', '1'); } catch {} sync(); }
        if (e.pointerType === 'touch') {
          touches.set(e.pointerId, e.clientY);
          // A finger scrolls when you write with a pen (so a resting palm leaves no marks), or when a second finger lands.
          if (penSeen || touches.size > 1) {
            if (current && current.touch) { page.strokes.pop(); current = null; redraw(); }
            return;
          }
        }
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        try { canvas.setPointerCapture(e.pointerId); } catch {}
        const q = at(e);
        if (erasing || isEraserEnd(e)) { erase = { id: e.pointerId, removed: [] }; eraseAt(q); return; }
        const k = { c: colour, s: SIZES[size], pts: [{ ...q, p: pressure(e), t: Date.now() }] };
        page.strokes.push(k);
        current = { id: e.pointerId, stroke: k, touch: e.pointerType === 'touch' };
        drawStroke(ctx, k);
      });
      canvas.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch' && touches.has(e.pointerId) && (!current || current.id !== e.pointerId)) {
          if (penSeen || touches.size > 1) {
            const y0 = touches.get(e.pointerId);
            scroller.scrollTop -= (e.clientY - y0) / Math.max(1, touches.size);
            touches.set(e.pointerId, e.clientY);
          }
          return;
        }
        if (erase && erase.id === e.pointerId) { eraseAt(at(e)); return; }
        if (!current || current.id !== e.pointerId) return;
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        const k = current.stroke, from = k.pts.length;
        for (const ev of (evs.length ? evs : [e])) {
          const q = at(ev), last = k.pts[k.pts.length - 1];
          if (Math.hypot(q.x - last.x, q.y - last.y) < 0.6) continue;
          k.pts.push({ ...q, p: pressure(ev), t: Date.now() });
        }
        if (k.pts.length > from) drawStroke(ctx, k, from);
      });
      const end = e => {
        touches.delete(e.pointerId);
        if (erase && erase.id === e.pointerId) {
          if (erase.removed.length) record({ removed: erase.removed.slice().reverse() });
          erase = null; return;
        }
        if (!current || current.id !== e.pointerId) return;
        const k = current.stroke; current = null;
        if (e.type === 'pointercancel') { page.strokes.splice(page.strokes.indexOf(k), 1); redraw(); return; }
        record({ add: k });
        growIfNeeded(k.pts.reduce((m, q) => Math.max(m, q.y), 0));
      };
      canvas.addEventListener('pointerup', end);
      canvas.addEventListener('pointercancel', end);
      canvas.addEventListener('contextmenu', e => e.preventDefault());

      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); finish(null); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      };
      document.addEventListener('keydown', onKey, true);

      let closing = false;
      async function finish(how) {
        if (closing) return;
        if (how === null && changed && page.strokes.length && !window.confirm('Discard this handwriting?')) return;
        closing = true;
        let result = null;
        if (how === 'delete') result = 'delete';
        else if (how === 'done') {
          if (!page.strokes.length) result = existing ? 'delete' : null;
          else if (!changed && existing) result = null;
          else result = { dataUrl: picture(page), ink: await encode(page) };
        }
        ro.disconnect();
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        resolve(result);
      }

      sync();
      layout();
    });
  }

  window.WellWriteInk = { open, encode, decode, picture, PREFIX };
})();
