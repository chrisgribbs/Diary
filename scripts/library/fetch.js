'use strict';
/**
 * Fetch the raw texts for the Bible study library (run in GitHub Actions: the sites aren't reachable from everywhere).
 *
 *   node scripts/library/fetch.js <outDir>
 *
 * Finds candidate editions by catalogue (Project Gutenberg's catalogue, archive.org's search, CrossWire's module
 * list), downloads their plain text, and writes <outDir>/index.json describing every file: where it came from, its
 * title, date and the rights statement the site gives. Nothing is chosen or trusted here: build.js uses only the
 * editions named in sources.json, after each one has been checked by hand.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(process.argv[2] || 'library-raw');
const UA = 'WellWrite library builder (https://github.com/chrisgribbs/Diary)';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function get(url, { as = 'text', tries = 3 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : as === 'json' ? res.json() : res.text();
    } catch (e) {
      if (i >= tries) throw e;
      await wait(2000 * i);
    }
  }
}

// ---- Project Gutenberg: by author or title in the catalogue
const GUTENBERG = [
  { id: 'maclaren', author: /Maclaren, Alexander/i, title: /Exposition/i },
  { id: 'expositors', title: /Expositor'?s Bible/i },
  { id: 'edersheim', author: /Edersheim/i },
  { id: 'meyer', author: /Meyer, F\. ?B\./i },
  { id: 'vincent', author: /Vincent, Marvin/i },
  { id: 'hastings', author: /Hastings, James/i },
  { id: 'robertson', author: /Robertson, A\. ?T\./i },
  { id: 'kempis', title: /Imitation of Christ/i },
  { id: 'lawrence', author: /Lawrence, Brother|Brother Lawrence/i },
  { id: 'julian', author: /Julian, of Norwich/i },
  { id: 'augustine', author: /Augustine/i, title: /Confessions/i },
  { id: 'cloud', title: /Cloud of Unknowing/i },
  { id: 'teresa', author: /Teresa/i },
  { id: 'johncross', author: /John of the Cross/i },
];

// ---- archive.org: scanned editions (the OCR text)
const ARCHIVE = [
  { id: 'hastings', q: 'title:("great texts of the bible") AND mediatype:texts' },
  { id: 'vincent', q: 'title:("word studies in the new testament") AND creator:(vincent) AND mediatype:texts' },
  { id: 'meyer', q: 'title:("through the bible day by day") AND mediatype:texts' },
  { id: 'robertson', q: 'title:("word pictures in the new testament") AND mediatype:texts' },
  { id: 'teresa', q: 'title:("interior castle") AND mediatype:texts AND date:[1900-01-01 TO 1928-12-31]' },
  { id: 'johncross', q: 'title:("dark night of the soul") AND mediatype:texts AND date:[1860-01-01 TO 1928-12-31]' },
  { id: 'expositors', q: 'title:("expositor\'s bible") AND mediatype:texts AND date:[1887-01-01 TO 1910-12-31]', rows: 150 },
  { id: 'maclaren', q: 'title:("expositions of holy scripture") AND creator:(maclaren) AND mediatype:texts', rows: 80 },
  { id: 'edersheim', q: 'title:("life and times of jesus the messiah") AND mediatype:texts AND date:[1883-01-01 TO 1928-12-31]', rows: 30 },
  { id: 'kempis', q: 'title:("imitation of christ") AND (creator:(benham) OR description:(benham)) AND mediatype:texts', rows: 20 },
  { id: 'lawrence', q: 'title:("practice of the presence of god") AND mediatype:texts AND date:[1880-01-01 TO 1928-12-31]', rows: 20 },
  { id: 'julian', q: 'title:("revelations of divine love") AND (creator:(warrack) OR description:(warrack)) AND mediatype:texts', rows: 20 },
  { id: 'augustine', q: 'title:(confessions) AND creator:(augustine) AND (creator:(pusey) OR description:(pusey)) AND mediatype:texts', rows: 20 },
  { id: 'cloud', q: 'title:("cloud of unknowing") AND (creator:(underhill) OR description:(underhill)) AND mediatype:texts', rows: 20 },
];
// FETCH_ONLY=edersheim,kempis fetches just those, adding to what's already in the folder.
const ONLY = (process.env.FETCH_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const wanted = id => !ONLY.length || ONLY.includes(id);

// ---- CrossWire SWORD modules
const CROSSWIRE = [
  { id: 'robertson', module: 'RWP' },
];

// ---- Direct downloads from the publisher (openly licensed, not public domain: the licence is checked by hand)
const DIRECT = [
  { id: 'tosn', url: 'https://tyndaleopenresources.com/wp-content/themes/tyndale-openresources/files/tyndale_open-studynotes.zip', file: 'tyndale_open-studynotes.zip',
    title: 'Tyndale Open Study Notes', rights: 'CC BY-SA 4.0 (tyndaleopenresources.com)' },
  { id: 'tobd', url: 'https://tyndaleopenresources.com/wp-content/themes/tyndale-openresources/files/TyndaleOpenBibleDictionary.zip', file: 'TyndaleOpenBibleDictionary.zip',
    title: 'Tyndale Open Bible Dictionary', rights: 'CC BY-SA 4.0 (tyndaleopenresources.com)' },
];

function csvRows(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const indexFile = path.join(OUT, 'index.json');
  const index = ONLY.length && fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')).filter(f => !ONLY.includes(f.src)) : [];
  const save = (src, name, data, info) => {
    const dir = path.join(OUT, src);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
    index.push({ src, file: `${src}/${name}`, bytes: data.length, ...info });
  };

  // Gutenberg
  if (GUTENBERG.some(g => wanted(g.id))) try {
    const rows = csvRows(await get('https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv'));
    const head = rows.shift();
    const col = n => head.indexOf(n);
    const [cId, cType, cTitle, cAuthors, cLang, cIssued] = ['Text#', 'Type', 'Title', 'Authors', 'Language', 'Issued'].map(col);
    for (const g of GUTENBERG.filter(g => wanted(g.id))) {
      const hits = rows.filter(r => r[cType] === 'Text' && r[cLang] === 'en' && (!g.author || g.author.test(r[cAuthors] || '')) && (!g.title || g.title.test(r[cTitle] || '')));
      console.log(`gutenberg ${g.id}: ${hits.length}`);
      for (const r of hits.slice(0, 80)) {
        const n = r[cId];
        try {
          const txt = await get(`https://www.gutenberg.org/cache/epub/${n}/pg${n}.txt`);
          save(g.id, `pg${n}.txt`, txt, { site: 'gutenberg', url: `https://www.gutenberg.org/ebooks/${n}`, title: r[cTitle], authors: r[cAuthors], issued: r[cIssued], rights: 'Public domain in the USA (Project Gutenberg)' });
        } catch (e) { console.log('  failed', n, e.message); }
        await wait(1200);
      }
    }
  } catch (e) { console.log('gutenberg catalogue failed:', e.message); }

  // archive.org
  for (const a of ARCHIVE.filter(a => wanted(a.id))) {
    try {
      const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(a.q)}&fl[]=identifier&fl[]=title&fl[]=date&fl[]=creator&fl[]=volume&fl[]=publisher&fl[]=possible-copyright-status&rows=${a.rows || 60}&output=json`;
      const docs = (await get(url, { as: 'json' })).response.docs;
      console.log(`archive ${a.id}: ${docs.length}`);
      for (const d of docs) {
        try {
          const meta = await get(`https://archive.org/metadata/${d.identifier}`, { as: 'json' });
          const f = (meta.files || []).find(x => /_djvu\.txt$/.test(x.name));
          if (!f) continue;
          const txt = await get(`https://archive.org/download/${d.identifier}/${encodeURIComponent(f.name)}`);
          const m = meta.metadata || {};
          save(a.id, `${d.identifier}.txt`, txt, { site: 'archive.org', url: `https://archive.org/details/${d.identifier}`, title: [].concat(m.title || d.title).join(' '),
            authors: [].concat(m.creator || d.creator || []).join('; '), issued: [].concat(m.date || d.date || []).join(' '), volume: [].concat(m.volume || []).join(' '),
            publisher: [].concat(m.publisher || []).join(' '), rights: [].concat(m['possible-copyright-status'] || m.rights || []).join(' '), sponsor: [].concat(m.sponsor || m.contributor || []).join(' ') });
        } catch (e) { console.log('  failed', d.identifier, e.message); }
        await wait(800);
      }
    } catch (e) { console.log(`archive ${a.id} search failed:`, e.message); }
  }

  // CrossWire
  for (const c of CROSSWIRE.filter(c => wanted(c.id))) {
    try {
      const zip = await get(`https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/${c.module}.zip`, { as: 'buffer' });
      save(c.id, `${c.module}.zip`, zip, { site: 'crosswire', url: `https://crosswire.org/sword/modules/ModInfo.jsp?modName=${c.module}`, title: c.module, rights: 'see module .conf' });
      console.log(`crosswire ${c.module}: ${zip.length} bytes`);
    } catch (e) { console.log(`crosswire ${c.module} failed:`, e.message); }
  }

  // Direct
  for (const d of DIRECT.filter(d => wanted(d.id))) {
    try {
      const buf = await get(d.url, { as: 'buffer' });
      save(d.id, d.file, buf, { site: 'tyndaleopenresources.com', url: d.url, title: d.title, rights: d.rights });
      console.log(`direct ${d.id}: ${buf.length} bytes`);
    } catch (e) { console.log(`direct ${d.id} failed:`, e.message); }
  }

  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
  console.log(`${index.length} files, ${(index.reduce((n, f) => n + f.bytes, 0) / 1048576).toFixed(1)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
