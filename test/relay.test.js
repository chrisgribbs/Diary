'use strict';
// The shared Bible relay (relay/worker.mjs) and the app using it: only WellWrite's reading requests go through,
// the key is added there (never sent by the app), answers are cached, and each device has a daily limit.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { ApiBible } = require('../src/apibible');

(async () => {
  const { default: worker } = await import('../relay/worker.mjs');
  // Stand-ins for API.Bible and Cloudflare's cache.
  const upstream = [];
  global.fetch = async (req, opts = {}) => {
    const url = typeof req === 'string' ? req : req.url;
    const headers = new Headers(opts.headers || (req.headers || {}));
    upstream.push({ url, key: headers.get('api-key') });
    if (url.startsWith('https://fums.api.bible')) return new Response(null, { status: 204 });
    if (/\/bibles\?/.test(url)) return Response.json({ data: [{ id: 'de4e12af7f28f599-02', name: 'King James (Authorised) Version', abbreviation: 'engKJV', language: { name: 'English' } }, { id: '78a9f6124f344018-01', name: 'New International Version', abbreviation: 'NIV', language: { name: 'English' } }] });
    if (/\/passages\//.test(url)) return Response.json({ data: { content: [{ name: 'para', type: 'tag', attrs: { style: 'q1' }, items: [{ type: 'text', text: 'Be still, and know that I am God.', attrs: { verseId: 'PSA.46.10' } }] }], copyright: 'NIV ©' }, meta: { fumsToken: 'tok' } });
    return Response.json({ data: {} });
  };
  const store = new Map();
  global.caches = { default: { match: async r => (store.has(r.url) ? store.get(r.url).clone() : undefined), put: async (r, res) => { store.set(r.url, res); } } };
  const env = { APIBIBLE_KEY: 'secret-key-123' };
  const waits = [];
  const ctx = { waitUntil: p => waits.push(p) };
  const call = (p, device = 'a1b2c3d4e5f6a7b8', method = 'GET') => worker.fetch(new Request('https://relay.example' + p, { method, headers: device ? { 'x-wellwrite-device': device } : {} }), env, ctx);

  assert.equal((await (await call('/health')).json()).key, true);
  // Only reading requests WellWrite makes.
  assert.equal((await call('/v1/bibles/abc/books')).status, 404);
  assert.equal((await call('/v1/bibles', 'a1b2c3d4e5f6a7b8', 'POST')).status, 405);
  assert.equal((await call('/v1/bibles?language=eng', '')).status, 403, 'needs a device id');
  // A passage: the key is added by the relay; the second time comes from the cache.
  const p = '/v1/bibles/78a9f6124f344018-01/passages/PSA.46.10-PSA.46.10?content-type=json';
  const r1 = await call(p); assert.equal(r1.status, 200); await Promise.all(waits);
  assert.equal(upstream.at(-1).key, 'secret-key-123');
  const n = upstream.length;
  const r2 = await call(p); assert.equal(r2.status, 200);
  assert.equal(upstream.length, n, 'cached');
  // The daily limit per device.
  let last; for (let i = 0; i < 401; i++) last = await call('/v1/bibles?language=eng', 'ffffeeee00001111');
  assert.equal(last.status, 429);
  assert.equal((await call('/v1/bibles?language=eng', 'ffffeeee00002222')).status, 200, 'another device is fine');
  // No key set up yet.
  assert.equal((await worker.fetch(new Request('https://relay.example/v1/bibles', { headers: { 'x-wellwrite-device': 'a1b2c3d4e5f6a7b8' } }), {}, ctx)).status, 503);

  // The app, through the relay (served locally), with no key of its own.
  const srv = http.createServer(async (req, res) => {
    const r = await worker.fetch(new Request('http://127.0.0.1' + req.url, { headers: req.headers }), env, ctx);
    res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const realFetch = global.fetch;
  const nodeFetch = (url, o) => (url.startsWith('http://127.0.0.1') ? fetch.__node(url, o) : realFetch(url, o));
  fetch.__node = (await import('node:http')) && ((url, o) => new Promise((resolve, reject) => {
    const req = http.get(url, { headers: (o && o.headers) || {} }, res => { const b = []; res.on('data', c => b.push(c)); res.on('end', () => resolve(new Response(Buffer.concat(b), { status: res.statusCode }))); });
    req.on('error', reject);
  }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-relay-'));
  const ab = new ApiBible({ file: path.join(dir, 'apibible.json'), protect: x => x, unprotect: x => x, fetch: nodeFetch, relay: `http://127.0.0.1:${srv.address().port}` });
  const st = ab.status();
  assert.ok(st.shared && !st.connected, 'shared versions without a key');
  await ab.sharedDefaults();
  assert.deepEqual(ab.versions().map(v => v.abbr), ['NIV'], 'popular English versions picked');
  const v = await ab.passage('78a9f6124f344018-01', 'Psalms 46:10');
  assert.match(v.text, /Be still/);
  assert.equal(v.translation, 'NIV');
  srv.close(); fs.rmSync(dir, { recursive: true, force: true });
  console.log('relay tests passed');
})().catch(e => { console.error(e); process.exit(1); });
