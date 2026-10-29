'use strict';
// Tests automatic backups (folder + Google Drive) against a fake Google server.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Vault } = require('../src/vault');
const { GoogleDrive } = require('../src/gdrive');
const { BackupManager, backupName, AUTO_NAME_RE, suggestFolders } = require('../src/backup');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'daybook-bk-'));
const t0 = Date.now();

// ---------- fake Google ----------
function fakeGoogle() {
  const files = new Map();
  let n = 0, sessions = new Map();
  const log = [];
  const tokens = { valid: new Set(), refresh: 'rt-good' };
  const idToken = 'x.' + Buffer.from(JSON.stringify({ email: 'chris@example.com' })).toString('base64url') + '.y';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const json = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    log.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/token') {
      const p = new URLSearchParams(body.toString());
      assert.equal(p.get('client_id'), 'cid');
      if (p.get('grant_type') === 'authorization_code') {
        assert.equal(p.get('code'), 'auth-code');
        assert(p.get('code_verifier').length >= 43);
        tokens.valid.add('at1');
        return json(200, { access_token: 'at1', refresh_token: tokens.refresh, expires_in: 3600, id_token: idToken });
      }
      if (p.get('refresh_token') !== tokens.refresh) return json(400, { error: 'invalid_grant' });
      tokens.valid.add('at2');
      return json(200, { access_token: 'at2', expires_in: 3600 });
    }
    if (url.pathname === '/revoke') return json(200, {});
    if (!tokens.valid.has((req.headers.authorization || '').replace('Bearer ', '')) && !url.pathname.startsWith('/session/')) return json(401, { error: { message: 'bad token' } });

    if (url.pathname === '/upload/files' && req.method === 'POST') {
      const id = 's' + (++n); sessions.set(id, JSON.parse(body.toString()));
      res.writeHead(200, { Location: `http://127.0.0.1:${server.address().port}/session/${id}` }); return res.end();
    }
    if (url.pathname.startsWith('/session/') && req.method === 'PUT') {
      const meta = sessions.get(url.pathname.split('/')[2]);
      const id = 'f' + (++n);
      files.set(id, { id, ...meta, data: body, trashed: false, createdTime: new Date(Date.now() + n * 1000).toISOString() });
      return json(200, { id, name: meta.name, size: String(body.length) });
    }
    if (url.pathname === '/api/files' && req.method === 'POST') {
      const meta = JSON.parse(body.toString()); const id = 'd' + (++n);
      files.set(id, { id, ...meta, parents: ['root'], trashed: false, createdTime: new Date().toISOString() });
      return json(200, { id });
    }
    if (url.pathname === '/api/files' && req.method === 'GET') {
      const q = url.searchParams.get('q');
      const parent = (q.match(/'([^']+)' in parents/) || [])[1];
      let list = [...files.values()].filter(f => !f.trashed && (f.parents || []).includes(parent));
      const name = (q.match(/name='([^']+)'/) || [])[1];
      if (name) list = list.filter(f => f.name === name);
      if (/mimeType!=/.test(q)) list = list.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
      list.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
      return json(200, { files: list.map(f => ({ id: f.id, name: f.name, size: f.data ? String(f.data.length) : undefined, createdTime: f.createdTime })) });
    }
    const m = url.pathname.match(/^\/api\/files\/([^/]+)$/);
    if (m) {
      const f = files.get(decodeURIComponent(m[1]));
      if (!f) return json(404, { error: { message: 'not found' } });
      if (req.method === 'PATCH') { Object.assign(f, JSON.parse(body.toString())); return json(200, {}); }
      if (url.searchParams.get('alt') === 'media') { res.writeHead(200); return res.end(f.data); }
      return json(200, { id: f.id, trashed: f.trashed });
    }
    json(404, {});
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, files, log, tokens, base: `http://127.0.0.1:${server.address().port}` })));
}

function makeDrive(g, dir) {
  return new GoogleDrive({
    config: { clientId: 'cid', clientSecret: 'secret' },
    storeFile: path.join(dir, 'google.json'),
    protect: s => 'test:' + Buffer.from(s).toString('base64'),
    unprotect: s => Buffer.from(s.slice(5), 'base64').toString(),
    // Pretend to be the user's browser: approve and follow the redirect.
    openBrowser: async url => {
      const u = new URL(url);
      assert.equal(u.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/drive.file');
      assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
      const back = `${u.searchParams.get('redirect_uri')}/?code=auth-code&state=${u.searchParams.get('state')}`;
      const r = await fetch(back); assert.match(await r.text(), /connected/);
    },
    endpoints: { auth: g.base + '/auth', token: g.base + '/token', revoke: g.base + '/revoke', api: g.base + '/api', upload: g.base + '/upload' },
  });
}

(async () => {
  // ---------- journal ----------
  const dataDir = path.join(tmp, 'journal');
  const vault = new Vault(dataDir);
  vault.create('river-stone');
  const e1 = vault.save({ date: '2026-10-30', title: 'One', html: '<p>first</p>', text: 'first' });
  vault.save({ date: '2026-10-29', title: 'Two', html: '<p>second</p>', text: 'second' });
  vault.lock(); // backups must work while locked

  let clock = new Date('2026-10-30T08:00:00');
  const settings = { backupToFolder: true, backupToGoogle: false, backupDir: path.join(tmp, 'usb', 'Daybook backups'), backupEvery: 'daily', backupKeep: 2 };
  const g = await fakeGoogle();
  const drive = makeDrive(g, dataDir);
  const results = [];
  const bm = new BackupManager({ vault, dataDir, drive, getSettings: () => settings, now: () => clock, tmpDir: tmp, onResult: r => results.push(r) });

  // ---------- folder ----------
  assert.equal(backupName(clock), 'Daybook backup 2026-10-30 0800.daybook');
  assert(AUTO_NAME_RE.test(backupName(clock)));
  assert.equal(bm.isDue('start'), true);
  let r = await bm.run('start');
  assert.equal(r.ok, false, 'parent of folder missing -> error, not created');
  assert.match(r.error, /check it's connected/);
  assert(!fs.existsSync(path.join(tmp, 'usb')));

  fs.mkdirSync(path.join(tmp, 'usb'));
  assert.equal(bm.isDue('timer'), false, 'waits after an error');
  clock = new Date('2026-10-30T08:40:00');
  r = await bm.maybeRun('timer');
  assert(r && r.ok, 'retries later, creates the last folder level');
  assert.equal(r.count, 2);
  assert(fs.existsSync(path.join(settings.backupDir, 'Daybook backup 2026-10-30 0840.daybook')));
  assert.equal(bm.isDue('timer'), false, 'unchanged -> not due');

  vault.unlock('river-stone'); vault.save({ ...vault.get(e1.id), title: 'One edited' }); vault.lock();
  assert.equal(bm.isDue('timer'), false, 'daily: already backed up today');
  clock = new Date('2026-10-31T07:00:00');
  assert.equal(bm.isDue('timer'), true, 'daily: new day and changed');
  fs.writeFileSync(path.join(settings.backupDir, 'my notes.txt'), 'keep me');
  for (const t of ['2026-10-31T07:00:00', '2026-11-01T07:00:00', '2026-11-02T07:00:00']) {
    clock = new Date(t);
    vault.unlock('river-stone'); vault.save({ date: t.slice(0, 10), title: t, html: '', text: '' }); vault.lock();
    assert((await bm.maybeRun('timer')).ok);
  }
  const left = fs.readdirSync(settings.backupDir).sort();
  assert.deepEqual(left, ['Daybook backup 2026-11-01 0700.daybook', 'Daybook backup 2026-11-02 0700.daybook', 'my notes.txt'], 'keeps newest 2 and other files');

  // backup restores elsewhere with the password
  const other = new Vault(path.join(tmp, 'other'));
  assert.equal(other.restoreFresh(path.join(settings.backupDir, left[1]), 'river-stone'), 5);

  // weekly + close modes
  settings.backupEvery = 'weekly';
  vault.unlock('river-stone'); vault.save({ date: '2026-11-03', title: 'w', html: '', text: '' }); vault.lock();
  clock = new Date('2026-11-05T07:00:00');
  assert.equal(bm.isDue('timer'), false);
  clock = new Date('2026-11-09T07:00:00');
  assert.equal(bm.isDue('timer'), true);
  settings.backupEvery = 'close';
  assert.equal(bm.isDue('timer'), false);
  assert.equal(bm.isDue('close'), true);
  settings.backupToFolder = false;
  assert.equal(bm.isDue('close'), false);
  r = await bm.run('manual');
  assert.equal(r.ok, false); assert.equal(r.code, 'setup', 'nothing ticked');
  settings.backupToFolder = true; settings.backupEvery = 'daily';

  // ---------- Google Drive ----------
  settings.backupToFolder = false; settings.backupToGoogle = true;
  assert.equal(bm.blocker('google'), 'Connect Google Drive to start backing up');
  r = await bm.run('manual');
  assert.equal(r.ok, false); assert.equal(r.code, 'setup');

  const st = await drive.connect();
  assert.deepEqual(st, { available: true, connected: true, email: 'chris@example.com' });
  assert(!fs.readFileSync(path.join(dataDir, 'google.json'), 'utf8').includes('rt-good'), 'refresh token not stored in plain text');
  assert.equal(bm.isDue('connected'), true, 'connecting makes a backup due');

  for (const t of ['2026-11-10T07:00:00', '2026-11-11T07:00:00', '2026-11-12T07:00:00']) {
    clock = new Date(t);
    vault.unlock('river-stone'); vault.save({ date: t.slice(0, 10), title: 'g' + t, html: '', text: '' }); vault.lock();
    r = await bm.maybeRun('timer');
    assert(r && r.ok, JSON.stringify(r));
    assert.equal(r.where, 'Google Drive');
  }
  const folders = [...g.files.values()].filter(f => f.mimeType === 'application/vnd.google-apps.folder');
  assert.equal(folders.length, 1, 'one Daybook backups folder');
  assert.equal(folders[0].name, 'Daybook backups');
  const listed = await drive.list();
  assert.equal(listed.length, 2, 'pruned to newest 2');
  assert.equal(listed[0].name, 'Daybook backup 2026-11-12 0700.daybook');
  assert(!fs.readdirSync(tmp).some(f => /^daybook-.*\.daybook$/.test(f)), 'temp upload file cleaned up');

  // ---------- both at once ----------
  settings.backupToFolder = true;
  clock = new Date('2026-11-12T19:00:00');
  vault.unlock('river-stone'); vault.save({ date: '2026-11-12', title: 'both', html: '', text: '' }); vault.lock();
  assert.deepEqual(bm.dueDests('timer'), ['folder'], 'google already done today; folder last ran days ago');
  clock = new Date('2026-11-13T07:00:00');
  assert.deepEqual(bm.dueDests('timer'), ['google', 'folder']);
  r = await bm.maybeRun('timer');
  assert(r.ok, JSON.stringify(r));
  assert.equal(r.where, 'Google Drive and ' + settings.backupDir);
  assert(fs.existsSync(path.join(settings.backupDir, 'Daybook backup 2026-11-13 0700.daybook')));
  assert(!fs.readdirSync(settings.backupDir).some(f => f.endsWith('.part')));
  assert.equal((await drive.list())[0].name, 'Daybook backup 2026-11-13 0700.daybook');

  // one destination failing doesn't stop the other
  fs.rmSync(path.join(tmp, 'usb'), { recursive: true });
  clock = new Date('2026-11-14T07:00:00');
  vault.unlock('river-stone'); vault.save({ date: '2026-11-14', title: 'usb out', html: '', text: '' }); vault.lock();
  r = await bm.maybeRun('timer');
  assert.equal(r.ok, false);
  assert.equal(r.where, 'Google Drive');
  assert.match(r.error, /^This computer: Couldn't find the backup folder/);
  assert.equal(bm.destStatus('google').lastAt, clock.toISOString());
  assert(bm.destStatus('folder').lastError);
  assert.deepEqual(bm.dueDests('timer'), [], 'google up to date, folder waiting after error');
  fs.mkdirSync(path.join(tmp, 'usb'));
  clock = new Date('2026-11-14T07:45:00');
  assert.deepEqual(bm.dueDests('timer'), ['folder'], 'folder retried later on its own');
  assert((await bm.maybeRun('timer')).ok);
  settings.backupToFolder = false;

  // changing the folder starts its history fresh
  const old = settings.backupDir;
  settings.backupDir = path.join(tmp, 'usb', 'elsewhere');
  assert.deepEqual(bm.destStatus('folder'), {});
  settings.backupDir = old;

  // new computer: fresh drive object finds the existing folder, restore works
  const pc2 = path.join(tmp, 'pc2'); fs.mkdirSync(pc2);
  const drive2 = makeDrive(g, pc2);
  await drive2.connect();
  const got = await drive2.list();
  assert.equal(got.length, 2);
  const dl = path.join(pc2, 'dl.daybook');
  await drive2.download(got[0].id, dl);
  const v2 = new Vault(path.join(pc2, 'journal'));
  assert.equal(v2.restoreFresh(dl, 'river-stone'), 11);
  assert(v2.list().some(m => m.title === 'One edited'));

  // expired access token is refreshed transparently
  g.tokens.valid.clear();
  drive.access = null;
  assert.equal((await drive.list()).length, 2);

  // revoked access -> reauth error surfaced
  g.tokens.refresh = 'rt-new'; g.tokens.valid.clear(); drive.access = null;
  clock = new Date('2026-11-15T07:00:00');
  vault.unlock('river-stone'); vault.save({ date: '2026-11-15', title: 'x', html: '', text: '' }); vault.lock();
  r = await bm.maybeRun('timer');
  assert.equal(r.ok, false); assert.equal(r.code, 'reauth');
  assert.match(r.error, /Connect Google Drive again/);

  // sign-in cancelled in the browser
  const d3 = makeDrive(g, pc2);
  d3.openBrowser = async url => {
    const u = new URL(url);
    await fetch(`${u.searchParams.get('redirect_uri')}/?error=access_denied&state=${u.searchParams.get('state')}`);
  };
  await assert.rejects(d3.connect(), /cancelled/);

  // disconnect forgets the sign-in
  assert.deepEqual(await drive.disconnect(), { available: true, connected: false, email: '' });
  assert.equal(bm.blocker('google'), 'Connect Google Drive to start backing up');

  // not configured
  const none = new GoogleDrive({ config: null, storeFile: path.join(tmp, 'n.json') });
  assert.equal(none.available(), false);
  await assert.rejects(none.connect(), /not set up/);

  // folder suggestions on Windows
  const sugg = suggestFolders({ env: { USERPROFILE: '/home/chris', OneDrive: '/home/chris/OneDrive' }, exists: p => ['/home/chris/OneDrive', '/home/chris/Dropbox'].includes(p) });
  assert.deepEqual(sugg.map(s => s.label), ['OneDrive', 'Dropbox']);

  g.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`backup tests passed in ${Date.now() - t0} ms`);
})().catch(e => { console.error(e); process.exit(1); });
