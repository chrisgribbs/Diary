'use strict';
/**
 * Build the Bible study library packs.
 *
 *   node scripts/library/build.js <rawDir> <outDir>
 *
 * Reads scripts/library/sources.json: the editions chosen (each checked by hand: edition, date, licence), which pack
 * each belongs to, and which parser reads it. Each parser (scripts/library/parsers/<name>.js) turns a raw file into
 * sections: { section, refs, text }. Then: chunk (pack.js), tag, index, embed (with OPENROUTER_API_KEY), write each
 * pack, gzip its files, and write library.json (what the app downloads) and REPORT.md (what was built).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { chunk, writePack } = require('./pack');

const RAW = path.resolve(process.argv[2] || 'library-raw');
const OUT = path.resolve(process.argv[3] || 'library-out');
const CONF = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const EMBED = { model: 'perplexity/pplx-embed-v1-0.6b' };

async function embedder() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  return async texts => {
    for (let i = 1; ; i++) {
      const res = await fetch('https://openrouter.ai/api/v1/embeddings', { method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'WellWrite library builder' },
        body: JSON.stringify({ model: EMBED.model, input: texts }) });
      if (res.ok) { const j = await res.json(); return j.data.sort((a, b) => a.index - b.index).map(d => d.embedding); }
      if (i >= 5) throw new Error(`embeddings failed: ${res.status} ${await res.text()}`);
      await new Promise(r => setTimeout(r, 3000 * i));
    }
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const embed = await embedder();
  const report = ['# Bible study library', '', `Built ${new Date().toISOString().slice(0, 10)}. Embeddings: ${embed ? EMBED.model : 'none (no OPENROUTER_API_KEY), so search by meaning is off'}.`, ''];
  const offer = { version: CONF.version, packs: [] };
  for (const pack of CONF.packs) {
    const sources = {}, passages = [];
    const lines = [];
    for (const s of CONF.sources.filter(x => x.pack === pack.id)) {
      const parser = require(`./parsers/${s.parser}`);
      let sections = [];
      for (const f of s.files) {
        const file = path.join(RAW, f);
        if (!fs.existsSync(file)) { lines.push(`- ${s.id}: missing ${f}`); continue; }
        try { sections.push(...parser(fs.readFileSync(file, 'utf8'), { file: f, source: s })); }
        catch (e) { lines.push(`- ${s.id}: ${f} failed: ${e.message}`); }
      }
      sources[s.id] = { author: s.author, work: s.work, year: s.year, licence: s.licence, credit: s.credit, url: s.url, caveat: s.caveat || '' };
      const tagged = sections.filter(x => x.refs && x.refs.length).length;
      const parts = chunk(sections.map(x => ({ ...x, src: s.id, cat: x.cat || s.category })));
      passages.push(...parts);
      lines.push(`- ${s.author}, *${s.work}*: ${sections.length} sections (${tagged} tagged with verses), ${parts.length} passages`);
    }
    if (!passages.length) { report.push(`## ${pack.name}`, '', 'Nothing built yet.', ...lines, ''); continue; }
    const dir = path.join(OUT, 'packs', pack.id);
    const m = await writePack(dir, { id: pack.id, name: pack.name, about: pack.about, version: CONF.version, passages, sources,
      embed, embedInfo: embed ? EMBED : null, onProgress: (d, n) => { if (d % 640 === 0 || d === n) console.log(`${pack.id}: embedded ${d}/${n}`); } });
    const files = [];
    for (const name of fs.readdirSync(dir)) {
      const gz = zlib.gzipSync(fs.readFileSync(path.join(dir, name)), { level: 9 });
      fs.writeFileSync(path.join(OUT, `${pack.id}-${name}.gz`), gz);
      files.push({ name, size: gz.length, sha256: crypto.createHash('sha256').update(gz).digest('hex') });
    }
    const size = files.reduce((n, f) => n + f.size, 0);
    offer.packs.push({ id: pack.id, name: pack.name, about: pack.about, version: CONF.version, files });
    report.push(`## ${pack.name}`, '', `${m.count} passages, ${(size / 1048576).toFixed(1)} MB to download.`, '', ...lines, '');
  }
  fs.writeFileSync(path.join(OUT, 'library.json'), JSON.stringify(offer, null, 1));
  report.push('## Sources and licences', '', ...CONF.sources.map(s => `- **${s.author}, ${s.work}** (${s.year}). ${s.licence}. ${s.credit} ${s.url ? `<${s.url}>` : ''}`), '');
  fs.writeFileSync(path.join(OUT, 'REPORT.md'), report.join('\n'));
  console.log(report.join('\n'));
})().catch(e => { console.error(e); process.exit(1); });
