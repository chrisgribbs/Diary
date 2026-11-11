'use strict';
// A stand-in for the parts of Google's sign-in and Drive APIs that WellWrite uses, for tests.
// start() → { url, files, close() }. Any refresh token works; the sign-in page redirects straight back.
const http = require('http');

function start() {
  const files = new Map(); let n = 0;
  const FOLDER = 'application/vnd.google-apps.folder';
  const sessions = new Map();
  const json = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
  const body = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const pub = f => ({ id: f.id, name: f.name, version: String(f.version), trashed: !!f.trashed, createdTime: f.created, size: String(f.data ? f.data.length : 0), mimeType: f.mimeType });
  const matches = (f, q) => {
    if (/trashed=false/.test(q) && f.trashed) return false;
    let m;
    if ((m = q.match(/name='([^']+)'/)) && f.name !== m[1]) return false;
    if ((m = q.match(/mimeType='([^']+)'/)) && f.mimeType !== m[1]) return false;
    if ((m = q.match(/mimeType!='([^']+)'/)) && f.mimeType === m[1]) return false;
    if ((m = q.match(/'([^']+)' in parents/)) && !(f.parents || ['root']).includes(m[1])) return false;
    return true;
  };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    const data = await body(req);
    if (p === '/token') return json(res, 200, { access_token: 'tok', expires_in: 3600, refresh_token: 'refresh', id_token: 'x.' + Buffer.from(JSON.stringify({ email: 'me@example.com' })).toString('base64url') + '.y' });
    if (p === '/revoke') return json(res, 200, {});
    if (p === '/auth') { const r = new URL(u.searchParams.get('redirect_uri')); r.searchParams.set('code', 'c'); r.searchParams.set('state', u.searchParams.get('state')); res.writeHead(302, { Location: r.toString() }); return res.end(); }
    if (req.headers.authorization !== 'Bearer tok' && !p.startsWith('/session/')) return json(res, 401, { error: { message: 'no' } });
    let m;
    if (p === '/drive/v3/files' && req.method === 'GET') {
      const q = u.searchParams.get('q') || '';
      return json(res, 200, { files: [...files.values()].filter(f => matches(f, q)).map(pub) });
    }
    if (p === '/drive/v3/files' && req.method === 'POST') {
      const meta = JSON.parse(data.toString() || '{}');
      const f = { id: 'id' + (++n), name: meta.name, mimeType: meta.mimeType, parents: meta.parents || ['root'], version: 1, created: new Date().toISOString() };
      files.set(f.id, f); return json(res, 200, pub(f));
    }
    if ((m = p.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const f = files.get(decodeURIComponent(m[1]));
      if (!f) return json(res, 404, { error: { message: 'File not found' } });
      if (req.method === 'PATCH') { const meta = JSON.parse(data.toString() || '{}'); if ('trashed' in meta) f.trashed = meta.trashed; f.version++; return json(res, 200, pub(f)); }
      if (u.searchParams.get('alt') === 'media') { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(f.data || Buffer.alloc(0)); }
      return json(res, 200, pub(f));
    }
    if ((m = p.match(/^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/))) {
      const id = m[1] && decodeURIComponent(m[1]);
      if (id && (!files.get(id) || files.get(id).trashed)) return json(res, 404, { error: { message: 'File not found' } });
      const s = 's' + (++n); sessions.set(s, { id, meta: JSON.parse(data.toString() || '{}') });
      res.writeHead(200, { Location: `http://127.0.0.1:${server.address().port}/session/${s}` }); return res.end();
    }
    if ((m = p.match(/^\/session\/(.+)$/))) {
      const s = sessions.get(m[1]); sessions.delete(m[1]);
      let f = s.id && files.get(s.id);
      if (f) { f.data = data; f.version++; }
      else { f = { id: 'id' + (++n), name: s.meta.name, mimeType: s.meta.mimeType, parents: s.meta.parents || ['root'], data, version: 1, created: new Date().toISOString() }; files.set(f.id, f); }
      return json(res, 200, pub(f));
    }
    json(res, 404, { error: { message: 'Unknown ' + req.method + ' ' + p } });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}`, files, close: () => server.close() })));
}
module.exports = { start };
