'use strict';
/**
 * The book as a Word document (.docx): a title page, then each chapter on a new page with its heading and passage,
 * and the writing with its bold, italics, quotations and lists. Built by hand (a .docx is a zip of a few XML files),
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

/** [{ style, runs: [{ text, b, i, u }] }] from a chapter's HTML. */
function paragraphs(html) {
  const out = [];
  let cur = null, style = 'Normal', list = [];
  const fmt = { b: 0, i: 0, u: 0 };
  const start = s => { if (!cur || cur.runs.length) { cur = { style: s || style, runs: [] }; out.push(cur); } else cur.style = s || style; };
  const end = () => { cur = null; };
  for (const m of String(html || '').matchAll(/<(\/?)([a-z0-9]+)[^>]*>|([^<]+)/gi)) {
    if (m[3] != null) {
      const text = unent(m[3]).replace(/\s+/g, ' ');
      if (!text.trim() && !cur) continue;
      if (!cur) start();
      cur.runs.push({ text, b: fmt.b > 0, i: fmt.i > 0, u: fmt.u > 0 });
      continue;
    }
    const close = m[1] === '/', tag = m[2].toLowerCase();
    if (/^(b|strong)$/.test(tag)) fmt.b += close ? -1 : 1;
    else if (/^(i|em|cite)$/.test(tag)) fmt.i += close ? -1 : 1;
    else if (tag === 'u') fmt.u += close ? -1 : 1;
    else if (tag === 'br') { if (cur) cur.runs.push({ br: true }); }
    else if (/^h[1-3]$/.test(tag)) { if (close) { end(); } else start('Heading2'); }
    else if (tag === 'blockquote') { style = close ? 'Normal' : 'Quote'; end(); }
    else if (tag === 'ul' || tag === 'ol') { if (close) list.pop(); else list.push({ kind: tag, n: 0 }); end(); }
    else if (tag === 'li') {
      if (close) { end(); continue; }
      const l = list[list.length - 1] || { kind: 'ul', n: 0 }; l.n++;
      start('ListParagraph'); cur.runs.push({ text: l.kind === 'ol' ? `${l.n}. ` : '• ' });
    }
    else if (/^(p|div)$/.test(tag)) { if (close) end(); else start(); }
  }
  for (const p of out) {   // tidy the edges of each paragraph
    const r = p.runs.filter(x => !x.br);
    if (r.length) { r[0].text = r[0].text.replace(/^\s+/, ''); r[r.length - 1].text = r[r.length - 1].text.replace(/\s+$/, ''); }
  }
  return out.filter(p => p.runs.some(r => r.br || r.text));
}

const run = r => r.br ? '<w:r><w:br/></w:r>'
  : `<w:r>${r.b || r.i || r.u ? `<w:rPr>${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.u ? '<w:u w:val="single"/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`;
const para = (style, runs) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.map(run).join('')}</w:p>`;
const plain = (style, text) => para(style, [{ text }]);

function documentXml(book) {
  const body = [];
  body.push(plain('Title', book.info.title));
  if (book.info.subtitle) body.push(plain('Subtitle', book.info.subtitle));
  const chapters = Book.ordered(book);
  chapters.forEach((c, n) => {
    body.push(plain('Heading1', c.title || `Chapter ${n + 1}`));
    if (c.passage) body.push(plain('Passage', c.passage));
    for (const p of paragraphs(c.html)) body.push(para(p.style, p.runs));
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia"/><w:sz w:val="24"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1200" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Passage"><w:name w:val="Passage"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="480"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/><w:spacing w:after="80"/></w:pPr></w:style>
</w:styles>`;

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
    ['word/styles.xml', STYLES],
    ['word/document.xml', documentXml(book)],
  ]);
}

module.exports = { bookDocx, paragraphs, zip, crc32 };
