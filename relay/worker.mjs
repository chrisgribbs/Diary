// WellWrite's Bible relay (a Cloudflare Worker). The app asks this for Bible text; it asks API.Bible with WellWrite's
// own key, which lives here as a secret (APIBIBLE_KEY) and never in the app. Only the few read-only requests the app
// makes are passed on, answers are cached for a day to spare the shared quota, and each phone or computer has a
// daily limit so nobody can use it all up.
const API = 'https://rest.api.bible/v1';
const FUMS = 'https://fums.api.bible/f3';
const DAILY_LIMIT = 400;            // requests per device per day (reading a chapter is one)
const CACHE_SECONDS = 24 * 60 * 60;
const ID = '[A-Za-z0-9-]{4,64}';
const ALLOWED = [
  new RegExp(`^/v1/bibles$`),
  new RegExp(`^/v1/bibles/${ID}/passages/[A-Z0-9]{2,3}\\.\\d{1,3}\\.\\d{1,3}-[A-Z0-9]{2,3}\\.\\d{1,3}\\.\\d{1,3}$`),
  new RegExp(`^/v1/bibles/${ID}/chapters/[A-Z0-9]{2,3}\\.\\d{1,3}$`),
  new RegExp(`^/v1/bibles/${ID}/search$`),
];
const counts = new Map();   // per running copy of the relay: device+day → requests (a rough guard)

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json(405, { message: 'Only reading is allowed' });
    if (url.pathname === '/' || url.pathname === '/health') return json(200, { ok: true, service: 'WellWrite Bible relay', key: !!env.APIBIBLE_KEY });
    // API.Bible's fair-use reporting, passed on as the app would have sent it.
    if (url.pathname === '/fums') {
      ctx.waitUntil(fetch(FUMS + url.search).catch(() => {}));
      return new Response(null, { status: 204 });
    }
    if (!ALLOWED.some(re => re.test(url.pathname))) return json(404, { message: 'Not something WellWrite asks for' });
    if (!env.APIBIBLE_KEY) return json(503, { message: 'The Bible relay isn’t set up yet' });

    const device = (request.headers.get('x-wellwrite-device') || '').slice(0, 40);
    if (!/^[a-f0-9]{8,40}$/.test(device)) return json(403, { message: 'WellWrite only' });
    const day = new Date().toISOString().slice(0, 10);
    const k = device + day;
    const n = (counts.get(k) || 0) + 1;
    if (counts.size > 5000) counts.clear();
    counts.set(k, n);
    if (n > DAILY_LIMIT) return json(429, { message: 'That’s a lot of Bible reading for one day: the shared versions rest until tomorrow. (Your own API.Bible key in Settings has no such limit.)' });

    // The same question within a day gets the same answer, without asking API.Bible again.
    const cache = caches.default;
    const cacheKey = new Request(API + url.pathname.slice(3) + url.search, { method: 'GET' });
    let res = await cache.match(cacheKey);
    if (!res) {
      const up = await fetch(cacheKey, { headers: { 'api-key': env.APIBIBLE_KEY, accept: 'application/json' } });
      res = new Response(up.body, { status: up.status, headers: { 'content-type': up.headers.get('content-type') || 'application/json', 'cache-control': `public, max-age=${CACHE_SECONDS}` } });
      if (up.ok) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    return res;
  },
};
