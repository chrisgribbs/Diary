'use strict';
/**
 * The book as a Word document (.docx): a title page, then each chapter on a new page with its heading and passage,
 * and the writing with its formatting, in the book's layout (font, spacing, indents, page size and margins). Built by hand (a .docx is a zip of a few XML files),
 * so it needs nothing installed. Phone-safe like the rest of src/.
 */
const zlib = require('zlib');
const Book = require('./book');

// ---------- a small zip writer (deflate, with CRC-32) ----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, 'utf8'), packed = zlib.deflateRawSync(data), nm = Buffer.from(name), crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, packed); central.push(c, nm); off += 30 + nm.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------- the writing (the editor's HTML) as Word paragraphs ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" };
const unent = s => s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));

// Classes the Book editor puts on a paragraph (renderer/book.js keeps only these).
const ALIGN = { 'al-l': 'left', 'al-c': 'center', 'al-r': 'right', 'al-j': 'both' };
const classesOf = attrs => ((/\bclass\s*=\s*"([^"]*)"/i.exec(attrs || '') || [])[1] || '').split(/\s+/).filter(Boolean);

/**
 * [{ style, runs: [{ text, b, i, u, s, sup, sub }], align, ind, first, br }] from a chapter's HTML.
 * `first` marks a paragraph that opens a section (after a heading, a quotation, a list, a break or the start),
 * which a book sets without a first-line indent. `br: 'page'` is a page break, style 'Break' a scene break.
 */
function paragraphs(html) {
  const out = [];
  let cur = null, style = 'Normal', list = [], quoteCls = [], after = true;   // `after`: the next paragraph opens a section
  const fmt = { b: 0, i: 0, u: 0, s: 0, sup: 0, sub: 0 };
  const start = (s, cls = []) => {
    const st = s || style;
    if (!cur || cur.runs.length) { cur = { style: st, runs: [] }; out.push(cur); } else cur.style = st;
    const all = st === 'Quote' ? [...quoteCls, ...cls] : cls;
    cur.align = all.map(c => ALIGN[c]).filter(Boolean).pop() || '';
    cur.ind = Math.max(0, ...all.map(c => (/^ind([1-4])$/.exec(c) || [0, 0])[1] | 0));
    if (all.includes('poem')) cur.style = 'Poem';
    cur.first = cur.style === 'Normal' && after;
  };
  const end = () => { if (cur && cur.runs.length) after = cur.style !== 'Normal'; cur = null; };
  for (const m of String(html || '').matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    if (m[4] != null) {
      const text = unent(m[4]).replace(/\s+/g, ' ');
      if (!text.trim() && !cur) continue;
      if (!cur) start();
      cur.runs.push({ text, b: fmt.b > 0, i: fmt.i > 0, u: fmt.u > 0, s: fmt.s > 0, sup: fmt.sup > 0, sub: fmt.sub > 0 });
      continue;
    }
    const close = m[1] === '/', tag = m[2].toLowerCase(), cls = close ? [] : classesOf(m[3]);
    if (/^(b|strong)$/.test(tag)) fmt.b += close ? -1 : 1;
    else if (/^(i|em|cite)$/.test(tag)) fmt.i += close ? -1 : 1;
    else if (tag === 'u') fmt.u += close ? -1 : 1;
    else if (/^(s|strike|del)$/.test(tag)) fmt.s += close ? -1 : 1;
    else if (tag === 'sup') fmt.sup += close ? -1 : 1;
    else if (tag === 'sub') fmt.sub += close ? -1 : 1;
    else if (tag === 'br') { if (cur) cur.runs.push({ br: true }); }
    else if (tag === 'hr') {
      end();
      out.push(cls.includes('pb') ? { style: 'Normal', runs: [{ page: true }], pageBreak: true } : { style: 'Break', runs: [{ text: '*   *   *' }] });
      after = true;
    }
    else if (/^h[1-3]$/.test(tag)) { if (close) { end(); after = true; } else start(tag === 'h3' ? 'Heading3' : 'Heading2', cls); }
    else if (tag === 'blockquote') { end(); style = close ? 'Normal' : 'Quote'; quoteCls = close ? [] : cls; if (close) after = true; }
    else if (tag === 'ul' || tag === 'ol') { if (close) { list.pop(); after = true; } else list.push({ kind: tag, n: 0 }); end(); }
    else if (tag === 'li') {
      if (close) { end(); continue; }
      const l = list[list.length - 1] || { kind: 'ul', n: 0 }; l.n++;
      start('ListParagraph', cls); cur.runs.push({ text: l.kind === 'ol' ? `${l.n}. ` : '• ' });
    }
    else if (/^(p|div)$/.test(tag)) { if (close) end(); else start(null, cls); }
  }
  for (const p of out) {   // tidy the edges of each paragraph
    while (p.runs.length && p.runs[p.runs.length - 1].br) p.runs.pop();   // the editor's trailing <br>
    if (!p.runs.length && p.style === 'Poem') p.runs.push({ text: '' });   // an empty line: a stanza break
    const r = p.runs.filter(x => !x.br && !x.page);
    if (r.length) { r[0].text = r[0].text.replace(/^\s+/, ''); r[r.length - 1].text = r[r.length - 1].text.replace(/\s+$/, ''); }
  }
  const kept = out.filter(p => p.pageBreak || p.style === 'Poem' || p.runs.some(r => r.br || r.text));
  kept.forEach((p, n) => { if (p.style === 'Poem' && (!kept[n + 1] || kept[n + 1].style !== 'Poem')) p.endPoem = true; });   // space after a poem's last line
  return kept;
}

const cmTw = cm => Math.round(cm * 567);   // twentieths of a point
const run = r => {
  if (r.br) return '<w:r><w:br/></w:r>';
  if (r.page) return '<w:r><w:br w:type="page"/></w:r>';
  const pr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.s ? '<w:strike/>' : '') + (r.u ? '<w:u w:val="single"/>' : '')
    + (r.sup ? '<w:vertAlign w:val="superscript"/>' : r.sub ? '<w:vertAlign w:val="subscript"/>' : '');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
};
function para(style, runs, p = {}, layout = Book.LAYOUT) {
  const ind = [];
  if (p.ind) ind.push(`w:left="${(style === 'Quote' ? 720 : style === 'ListParagraph' ? 720 : 0) + p.ind * 720}"`);
  if (p.first && layout.indent) ind.push('w:firstLine="0"');
  const pPr = `<w:pStyle w:val="${style}"/>${p.endPoem ? `<w:spacing w:after="${Math.round(layout.after * 20)}"/>` : ''}${p.align ? `<w:jc w:val="${p.align}"/>` : ''}${ind.length ? `<w:ind ${ind.join(' ')}/>` : ''}`;
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs.map(run).join('')}</w:p>`;
}
const plain = (style, text) => para(style, [{ text }]);

function documentXml(book) {
  const L = book.info.layout, body = [];
  body.push(plain('Title', book.info.title));
  if (book.info.subtitle) body.push(plain('Subtitle', book.info.subtitle));
  const chapters = Book.ordered(book);
  chapters.forEach((c, n) => {
    body.push(plain('Heading1', c.title || `Chapter ${n + 1}`));
    if (c.passage) body.push(plain('Passage', c.passage));
    for (const p of paragraphs(c.html)) body.push(para(p.style, p.runs, p, L));
  });
  const [w, h] = Book.PAGES[L.page], m = cmTw(Book.MARGINS[L.margins]);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${cmTw(w)}" w:h="${cmTw(h)}"/><w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

/** The styles, from the book's layout: the font, size, line and paragraph spacing, first-line indent and justification. */
function stylesXml(L) {
  const font = esc(L.font), hp = n => Math.round(n * 2);   // Word sizes are in half-points
  const body = Math.round(L.size * 2), noFirst = '<w:ind w:firstLine="0"/>', left = L.justify ? '<w:jc w:val="left"/>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${body}"/><w:szCs w:val="${body}"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="${Math.round(L.after * 20)}" w:line="${Math.round(L.line * 240)}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/>${L.indent ? `<w:ind w:firstLine="${cmTw(L.indent)}"/>` : ''}${L.justify ? '<w:jc w:val="both"/>' : ''}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="240"/>${noFirst}<w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="${hp(L.size * 2.33)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${noFirst}<w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="${hp(L.size * 1.25)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1200" w:after="120"/>${noFirst}${left}<w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="${hp(L.size * 1.67)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/>${noFirst}${left}<w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="${hp(L.size * 1.17)}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/>${noFirst}${left}<w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="${body}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Passage"><w:name w:val="Passage"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="480"/>${noFirst}${left}</w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720" w:firstLine="0"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Poem"><w:name w:val="Poem"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="0"/>${noFirst}${left}</w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Break"><w:name w:val="Scene break"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="240"/>${noFirst}<w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360" w:firstLine="0"/>${left}<w:spacing w:after="80"/></w:pPr></w:style>
</w:styles>`;
}

function bookDocx(book) {
  book = Book.cleanBook(book);
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(book.info.title)}</dc:title><dc:creator>WellWrite</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['word/styles.xml', stylesXml(book.info.layout)],
    ['word/document.xml', documentXml(book)],
  ]);
}

module.exports = { bookDocx, paragraphs, zip, crc32 };
