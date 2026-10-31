'use strict';
// Posting journal entries to your own WordPress site, through WordPress's REST API with an Application Password
// (WordPress → Users → Profile → Application Passwords). The password is kept encrypted on this computer.
// Nothing is sent unless you press "Post to WordPress" on an entry; posts are drafts unless you choose otherwise.
const fs = require('fs');
const crypto = require('crypto');

const SITE_RE = /^https?:\/\/[^\s/?#]+(?:\/[^\s?#]*)?$/i;

class WordPress {
  constructor({ file, protect, unprotect, fetch, available = () => true }) {
    Object.assign(this, { file, protect, unprotect, fetchImpl: fetch, available });
  }
  _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  _write(d) { fs.writeFileSync(this.file, JSON.stringify(d, null, 2)); }
  status() { const d = this._read(); return { connected: !!d.password, site: d.site || '', user: d.user || '', name: d.name || '' }; }

  static cleanSite(site) {
    let s = String(site || '').trim().replace(/\/+$/, '').replace(/\/wp-admin.*$/i, '').replace(/\/wp-json.*$/i, '');
    if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s;
    if (!SITE_RE.test(s)) throw new Error('That doesn’t look like a website address');
    const u = new URL(s);
    if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw new Error('Your site needs to use https:// so your password is sent securely');
    return s;
  }
  // WordPress answers at /wp-json/… with pretty permalinks, or at /?rest_route=… without them.
  _url(conn, route, query = '') {
    return conn.plain ? `${conn.site}/?rest_route=${route}${query ? '&' + query : ''}` : `${conn.site}/wp-json${route}${query ? '?' + query : ''}`;
  }
  _conn() {
    const d = this._read();
    if (!d.password) throw new Error('Connect your WordPress site in Settings first');
    return { site: d.site, plain: !!d.plain, auth: 'Basic ' + Buffer.from(`${d.user}:${this.unprotect(d.password)}`).toString('base64') };
  }
  async _req(conn, method, route, { query = '', json, body, headers = {} } = {}) {
    const res = await this.fetchImpl(this._url(conn, route, query), {
      method, headers: { Authorization: conn.auth, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const code = data && data.code;
      if (res.status === 401 || code === 'rest_not_logged_in' || code === 'incorrect_password' || code === 'invalid_username')
        throw Object.assign(new Error('WordPress didn’t accept that username and application password. (Some hosts block sign-in headers; your host can switch that on.)'), { status: 401 });
      if (res.status === 403) throw Object.assign(new Error('Your WordPress account isn’t allowed to do that (it needs to be an Author, Editor or Administrator)'), { status: 403 });
      if (res.status === 404 && code === 'rest_post_invalid_id') throw Object.assign(new Error('That post no longer exists on your site'), { status: 404, gone: true });
      throw Object.assign(new Error((data && data.message ? String(data.message).replace(/<[^>]+>/g, '') : 'WordPress error') + ` (${res.status})`), { status: res.status });
    }
    return data;
  }

  async connect(site, user, password) {
    site = WordPress.cleanSite(site);
    user = String(user || '').trim();
    password = String(password || '').replace(/\s+/g, ' ').trim();
    if (!user || !password) throw new Error('Enter your WordPress username and an application password');
    const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
    let me = null, plain = false, lastErr;
    for (const p of [false, true]) {
      try { me = await this._req({ site, plain: p, auth }, 'GET', '/wp/v2/users/me', { query: 'context=edit' }); plain = p; break; }
      catch (e) { lastErr = e; if (e.status === 401 || e.status === 403) throw e; }
    }
    if (!me) throw new Error('Couldn’t find WordPress at that address' + (lastErr ? ` (${lastErr.message})` : ''));
    const caps = me.capabilities || {};
    if (caps.publish_posts === false && caps.edit_posts === false) throw new Error('That account can’t write posts on this site');
    if (!this.available()) throw new Error('This computer can’t store the password securely');
    this._write({ site, user, plain, name: me.name || user, password: this.protect(password) });
    return this.status();
  }
  forget() { this._write({}); return this.status(); }

  /** Categories by path ("Work / Meetings"), created if missing; returns ids. */
  async _categories(conn, paths) {
    const ids = [];
    for (const p of paths || []) {
      let parent = 0;
      for (const name of String(p).split('/').map(s => s.trim()).filter(Boolean).slice(0, 2)) {
        const found = await this._req(conn, 'GET', '/wp/v2/categories', { query: `search=${encodeURIComponent(name)}&per_page=100` });
        let c = (found || []).find(x => decode(x.name).toLowerCase() === name.toLowerCase() && (x.parent || 0) === parent);
        if (!c) c = await this._req(conn, 'POST', '/wp/v2/categories', { json: { name, parent } });
        parent = c.id;
      }
      if (parent) ids.push(parent);
    }
    return [...new Set(ids)];
  }
  async _tags(conn, names) {
    const ids = [];
    for (const name of (names || []).map(s => String(s).trim()).filter(Boolean).slice(0, 30)) {
      const found = await this._req(conn, 'GET', '/wp/v2/tags', { query: `search=${encodeURIComponent(name)}&per_page=100` });
      let t = (found || []).find(x => decode(x.name).toLowerCase() === name.toLowerCase());
      if (!t) t = await this._req(conn, 'POST', '/wp/v2/tags', { json: { name } });
      ids.push(t.id);
    }
    return [...new Set(ids)];
  }
  /** Upload a data: URL image once; known (already uploaded) images are reused. */
  async _media(conn, dataUrl, name, known) {
    const m = String(dataUrl).match(/^data:(image\/(jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return null;
    const hash = crypto.createHash('sha1').update(m[3]).digest('hex').slice(0, 16);
    if (known[hash]) return { ...known[hash], hash };
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const file = `${String(name || 'journal').replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'journal'}-${hash.slice(0, 6)}.${ext}`;
    const r = await this._req(conn, 'POST', '/wp/v2/media', { body: Buffer.from(m[3], 'base64'), headers: { 'Content-Type': m[1], 'Content-Disposition': `attachment; filename="${file}"` } });
    return { id: r.id, url: r.source_url, hash };
  }

  /**
   * Create or update a post.
   * p: { title, content (block HTML with ⟦img:N:url⟧ / ⟦img:N:id⟧ placeholders), images: [dataUrl…], featured: dataUrl|null,
   *      status: 'draft'|'publish'|'private', date: 'YYYY-MM-DDTHH:MM:SS'|null, categories: [path], tags: [name], slugBase }
   * record: what was saved last time for this entry: { postId, media: { hash: {id, url} } }
   */
  async publish(p, record = {}) {
    const conn = this._conn();
    const known = { ...(record.media || {}) };
    const uploaded = [];
    for (let i = 0; i < (p.images || []).length; i++) {
      const r = await this._media(conn, p.images[i], p.slugBase, known);
      uploaded[i] = r;
      if (r) known[r.hash] = { id: r.id, url: r.url };
    }
    let content = String(p.content || '').replace(/⟦img:(\d+):(url|id)⟧/g, (_, n, what) => {
      const r = uploaded[+n];
      return r ? (what === 'url' ? r.url : String(r.id)) : (what === 'id' ? '0' : '');
    });
    let featured = 0;
    if (p.featured) { const r = await this._media(conn, p.featured, p.slugBase + '-feature', known); if (r) { featured = r.id; known[r.hash] = { id: r.id, url: r.url }; } }
    const body = {
      title: String(p.title || '').slice(0, 300), content,
      status: ['draft', 'publish', 'private'].includes(p.status) ? p.status : 'draft',
      categories: await this._categories(conn, p.categories),
      tags: await this._tags(conn, p.tags),
      ...(featured ? { featured_media: featured } : { featured_media: 0 }),
      ...(p.date ? { date: p.date } : {}),
    };
    let post;
    try {
      post = record.postId ? await this._req(conn, 'POST', `/wp/v2/posts/${record.postId}`, { json: body }) : null;
    } catch (e) { if (!e.gone) throw e; }   // deleted on the site: make a new one
    if (!post) post = await this._req(conn, 'POST', '/wp/v2/posts', { json: body });
    return { postId: post.id, link: post.link, status: post.status, media: known, site: conn.site, updated: new Date().toISOString() };
  }
}
const decode = s => String(s || '').replace(/&amp;/g, '&').replace(/&#039;|&#8217;/g, '’').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

module.exports = { WordPress };
