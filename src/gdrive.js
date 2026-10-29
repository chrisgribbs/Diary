'use strict';
/**
 * Google Drive backups.
 *
 *  - Signs in with OAuth 2.0 for desktop apps: the system browser opens Google's
 *    sign-in page and redirects back to a one-off server on 127.0.0.1 (PKCE).
 *  - Uses the drive.file scope, so WellWrite can only see files it created itself.
 *  - The refresh token is kept encrypted by the operating system (Windows DPAPI
 *    via the `protect`/`unprotect` functions passed in).
 *  - Backups go into a "WellWrite backups" folder in the user's Drive.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];
const FOLDER_NAME = 'WellWrite backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class GoogleDrive {
  /**
   * @param {object} o
   * @param {{clientId:string, clientSecret?:string}|null} o.config
   * @param {string} o.storeFile  where the (protected) sign-in is saved
   * @param {(s:string)=>string} o.protect    encrypt text for storage, returns base64
   * @param {(s:string)=>string} o.unprotect  reverse of protect
   * @param {(url:string)=>void} o.openBrowser
   * @param {typeof fetch} [o.fetch]
   * @param {object} [o.endpoints]  overridable for tests
   */
  constructor(o) {
    this.config = o.config && o.config.clientId ? o.config : null;
    this.storeFile = o.storeFile;
    this.protect = o.protect;
    this.unprotect = o.unprotect;
    this.openBrowser = o.openBrowser;
    this.fetch = o.fetch || fetch;
    this.ep = {
      auth: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      revoke: 'https://oauth2.googleapis.com/revoke',
      api: 'https://www.googleapis.com/drive/v3',
      upload: 'https://www.googleapis.com/upload/drive/v3',
      ...(o.endpoints || {}),
    };
    this.access = null; // { token, expires }
    this.pendingSignIn = null;
  }

  available() { return !!this.config; }

  _load() {
    try { return JSON.parse(fs.readFileSync(this.storeFile, 'utf8')); } catch { return null; }
  }
  _save(data) {
    const tmp = this.storeFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.storeFile);
  }

  status() {
    const d = this._load();
    return { available: this.available(), connected: !!(d && d.refresh), email: d ? d.email || '' : '' };
  }

  // ---------- sign in ----------
  async connect() {
    if (!this.config) throw new Error('Google Drive is not set up in this version of WellWrite');
    if (this.pendingSignIn) this.pendingSignIn.cancel();

    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const { code, redirectUri } = await new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, val) => {
        if (done) return; done = true;
        clearTimeout(timer); server.close(); this.pendingSignIn = null;
        err ? reject(err) : resolve(val);
      };
      const page = (title, msg) => `<!doctype html><meta charset="utf-8"><title>WellWrite</title>
<body style="font:17px/1.5 Georgia,serif;background:#1d2a47;color:#e9e4d6;display:grid;place-items:center;height:90vh;margin:0">
<div style="text-align:center;max-width:28em"><h1 style="font-style:italic;font-weight:500;color:#d6b263">${title}</h1><p>${msg}</p></div>`;

      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { res.writeHead(404).end(); return; }
        const p = url.searchParams;
        if (p.get('state') !== state) { res.writeHead(400).end('Unexpected request'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (p.get('error')) {
          res.end(page('Not connected', 'Google Drive was not connected. You can close this tab and try again from WellWrite.'));
          finish(new Error(p.get('error') === 'access_denied' ? 'Sign-in was cancelled' : 'Google sign-in failed: ' + p.get('error')));
        } else if (p.get('code')) {
          res.end(page('Google Drive connected', 'You can close this tab and go back to WellWrite.'));
          finish(null, { code: p.get('code'), redirectUri: `http://127.0.0.1:${server.address().port}` });
        } else res.end('Missing code');
      });
      const timer = setTimeout(() => finish(new Error('Sign-in timed out. Try again.')), SIGN_IN_TIMEOUT_MS);
      this.pendingSignIn = { cancel: () => finish(new Error('Sign-in was cancelled')) };
      server.on('error', e => finish(e));
      server.listen(0, '127.0.0.1', () => {
        const q = new URLSearchParams({
          client_id: this.config.clientId,
          redirect_uri: `http://127.0.0.1:${server.address().port}`,
          response_type: 'code',
          scope: SCOPES.join(' '),
          code_challenge: challenge,
          code_challenge_method: 'S256',
          access_type: 'offline',
          prompt: 'consent',
          state,
        });
        this.openBrowser(`${this.ep.auth}?${q}`);
      });
    });

    const tok = await this._token({
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri,
    });
    if (!tok.refresh_token) throw new Error('Google did not grant offline access. Try connecting again.');
    let email = '';
    try { email = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()).email || ''; } catch {}
    this._save({ email, refresh: this.protect(tok.refresh_token), folderId: null, connected: new Date().toISOString() });
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
    return this.status();
  }

  cancelConnect() { if (this.pendingSignIn) this.pendingSignIn.cancel(); }

  async disconnect() {
    const d = this._load();
    if (d && d.refresh) {
      try {
        await this.fetch(this.ep.revoke, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: this.unprotect(d.refresh) }).toString(),
        });
      } catch { /* offline: still forget it locally */ }
    }
    try { fs.unlinkSync(this.storeFile); } catch {}
    this.access = null;
    return this.status();
  }

  // ---------- HTTP ----------
  async _token(params) {
    const body = new URLSearchParams({ client_id: this.config.clientId, ...params });
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret);
    const r = await this.fetch(this.ep.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.error === 'invalid_grant'
        ? 'Google Drive access has expired or was removed. Connect Google Drive again.'
        : `Google sign-in failed (${j.error || r.status})`);
      e.code = j.error === 'invalid_grant' ? 'reauth' : 'http';
      throw e;
    }
    return j;
  }

  async _accessToken() {
    if (this.access && Date.now() < this.access.expires) return this.access.token;
    const d = this._load();
    if (!d || !d.refresh) { const e = new Error('Google Drive is not connected'); e.code = 'reauth'; throw e; }
    const tok = await this._token({ grant_type: 'refresh_token', refresh_token: this.unprotect(d.refresh) });
    this.access = { token: tok.access_token, expires: Date.now() + (tok.expires_in - 60) * 1000 };
    return this.access.token;
  }

  async _api(url, opts = {}, retry = true) {
    const token = await this._accessToken();
    const r = await this.fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
    if (r.status === 401 && retry) { this.access = null; return this._api(url, opts, false); }
    if (!r.ok) {
      let msg = '';
      try { const j = await r.json(); msg = j.error && (j.error.message || j.error); } catch {}
      if (r.status === 403 && /storage|quota/i.test(msg)) throw new Error('Your Google Drive is full');
      throw new Error(`Google Drive error ${r.status}${msg ? ': ' + msg : ''}`);
    }
    return r;
  }

  // ---------- folder ----------
  async _folderId() {
    const d = this._load() || {};
    if (d.folderId) {
      const r = await this._api(`${this.ep.api}/files/${encodeURIComponent(d.folderId)}?fields=id,trashed`).catch(() => null);
      if (r) { const j = await r.json(); if (!j.trashed) return j.id; }
    }
    // Look for one we made earlier (e.g. on another computer), else create it.
    const q = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`;
    const found = await (await this._api(`${this.ep.api}/files?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive' })}`)).json();
    let id = found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const made = await (await this._api(`${this.ep.api}/files?fields=id`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
      })).json();
      id = made.id;
    }
    this._save({ ...this._load(), folderId: id });
    return id;
  }

  // ---------- backups ----------
  /** Upload a local file into the backups folder. Resumable upload handles any size. */
  async upload(localFile, name) {
    const folder = await this._folderId();
    const data = fs.readFileSync(localFile);
    const start = await this._api(`${this.ep.upload}/files?uploadType=resumable&fields=id,name,size,createdTime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(data.length) },
      body: JSON.stringify({ name, parents: [folder], mimeType: 'application/octet-stream', appProperties: { wellwrite: 'backup' } }),
    });
    const session = start.headers.get('location');
    if (!session) throw new Error('Google Drive did not accept the upload');
    const r = await this.fetch(session, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
    if (!r.ok) throw new Error(`Upload to Google Drive failed (${r.status})`);
    return r.json();
  }

  /** Backups in the folder, newest first. */
  async list() {
    const folder = await this._folderId();
    const q = `'${folder}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`;
    const out = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, orderBy: 'createdTime desc', pageSize: '200', fields: 'nextPageToken,files(id,name,size,createdTime)', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const j = await (await this._api(`${this.ep.api}/files?${params}`)).json();
      out.push(...(j.files || []).filter(f => /\.(wellwrite|daybook)$/i.test(f.name)));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out.map(f => ({ id: f.id, name: f.name, size: +f.size || 0, created: f.createdTime }));
  }

  async download(id, localFile) {
    const r = await this._api(`${this.ep.api}/files/${encodeURIComponent(id)}?alt=media`);
    fs.writeFileSync(localFile, Buffer.from(await r.arrayBuffer()));
    return localFile;
  }

  /** Move all but the newest `keep` backups to the Drive bin. */
  async prune(keep) {
    if (!keep || keep < 1) return 0;
    const old = (await this.list()).slice(keep);
    for (const f of old) {
      await this._api(`${this.ep.api}/files/${encodeURIComponent(f.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      });
    }
    return old.length;
  }
}

module.exports = { GoogleDrive, FOLDER_NAME };
