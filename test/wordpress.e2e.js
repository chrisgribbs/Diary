'use strict';
// Posting an entry to WordPress (a local stand-in for a self-hosted site): connect, post as a draft with
// photos, category and tags, then update the same post without uploading the photos again.
// Run: xvfb-run -a npx electron --no-sandbox test/wordpress.e2e.js [shotdir]
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), http = require('http');
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-wp-'));
process.env.WELLWRITE_TEST_TRUST = '1';
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.js')) || path.join(os.tmpdir(), 'wellwrite-wp-shots'));
fs.mkdirSync(OUT, { recursive: true });

const USER = 'chris', PASS = 'abcd efgh ijkl mnop';
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
const wp = { posts: {}, media: [], cats: [{ id: 1, name: 'Uncategorized', parent: 0 }], tags: [], next: 100 };
const server = http.createServer((req, res) => {
  let body = [];
  req.on('data', c => body.push(c));
  req.on('end', () => {
    body = Buffer.concat(body);
    const send = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    const u = new URL(req.url, 'http://x');
    if (!u.pathname.startsWith('/wp-json/')) return send(404, { code: 'rest_no_route' });   // pretty permalinks on
    if (req.headers.authorization !== AUTH) return send(401, { code: 'incorrect_password', message: 'Wrong' });
    const route = u.pathname.slice(8);
    const json = () => JSON.parse(body.toString() || '{}');
    if (route === '/wp/v2/users/me') return send(200, { id: 1, name: 'Chris Gribble', capabilities: { publish_posts: true, edit_posts: true } });
    if (route === '/wp/v2/categories' && req.method === 'GET') return send(200, wp.cats.filter(c => c.name.toLowerCase().includes((u.searchParams.get('search') || '').toLowerCase())));
    if (route === '/wp/v2/categories') { const c = { id: wp.next++, ...json() }; wp.cats.push(c); return send(201, c); }
    if (route === '/wp/v2/tags' && req.method === 'GET') return send(200, wp.tags.filter(t => t.name.toLowerCase().includes((u.searchParams.get('search') || '').toLowerCase())));
    if (route === '/wp/v2/tags') { const t = { id: wp.next++, ...json() }; wp.tags.push(t); return send(201, t); }
    if (route === '/wp/v2/media') { const m = { id: wp.next++, type: req.headers['content-type'], name: req.headers['content-disposition'], bytes: body.length }; wp.media.push(m); return send(201, { id: m.id, source_url: `https://example.org/uploads/${m.id}.jpg` }); }
    if (route === '/wp/v2/posts') { const p = { id: wp.next++, ...json() }; wp.posts[p.id] = p; return send(201, { ...p, link: `https://example.org/?p=${p.id}` }); }
    const m = route.match(/^\/wp\/v2\/posts\/(\d+)$/);
    if (m) { if (!wp.posts[m[1]]) return send(404, { code: 'rest_post_invalid_id' }); Object.assign(wp.posts[m[1]], json()); return send(200, { ...wp.posts[m[1]], link: `https://example.org/?p=${m[1]}` }); }
    send(404, { code: 'rest_no_route' });
  });
});

const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-')));
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
server.listen(0, '127.0.0.1', () => {
  const SITE = `http://127.0.0.1:${server.address().port}`;
  const { getWindow } = require('../main.js');
  app.whenReady().then(async () => {
    while (!getWindow()) await wait(50);
    const win = getWindow();
    win.setSize(1280, 900);
    win.webContents.on('console-message', e => { const l = e.level ?? e.params?.level; if (l === 'error' || l === 3) errors.push(e.message ?? e.params?.message); });
    await new Promise(r => win.webContents.once('did-finish-load', r));
    await wait(400);
    const js = c => win.webContents.executeJavaScript(`(async () => { ${c} })()`).catch(e => { throw new Error(e.message + '\n  in: ' + c.slice(0, 160)); });
    const shot = async n => { await wait(400); fs.writeFileSync(path.join(OUT, n + '.png'), (await win.webContents.capturePage()).toPNG()); };
    const until = async (cond, ms = 6000) => { for (let t = 0; t < ms; t += 200) { if (await js(`return !!(${cond})`)) return true; await wait(200); } return false; };

    await js(`document.querySelector('#setupPw').value='river-stone'; document.querySelector('#setupPw2').value='river-stone'; document.querySelector('#setupForm').requestSubmit();`);
    await wait(2500);

    // the button only shows once a site is connected
    await js(`await newEntry(todayISO());`); await wait(500);
    assert.ok(await js(`return document.querySelector('#wpBtn').hidden`), 'hidden until connected');

    // connect in Settings: wrong password refused, right one accepted
    await js(`openSettings('wordpress');`); await wait(700);
    await js(`document.querySelector('#wpSite').value = '${SITE}'; document.querySelector('#wpUser').value = '${USER}'; document.querySelector('#wpPass').value = 'nope nope'; document.querySelector('#wpConnect').click();`); await wait(1000);
    assert.ok(await js(`return !!document.querySelector('#wpSite')`), 'wrong password refused');
    await js(`document.querySelector('#wpPass').value = '${PASS}'; document.querySelector('#wpConnect').click();`);
    assert.ok(await until(`document.querySelector('#wordpressBox') && document.querySelector('#wordpressBox').innerText.includes('Connected to')`), 'connected');
    assert.ok(!fs.readFileSync(path.join(process.env.WELLWRITE_DATA_DIR, 'wordpress.json'), 'utf8').includes('efgh'), 'password not stored in plain text');
    await shot('wp1-settings');
    await js(`document.querySelector('#dlg').close();`);

    // an entry with a heading, formatting, a list, a quote, a link and two photos
    const px = await js(`const c = document.createElement('canvas'); c.width = 60; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#d2a'; g.fillRect(0, 0, 60, 40); return c.toDataURL('image/jpeg', .8);`);
    const px2 = await js(`const c = document.createElement('canvas'); c.width = 60; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#2ad'; g.fillRect(0, 0, 60, 40); return c.toDataURL('image/jpeg', .8);`);
    await js(`document.querySelector('#title').value = 'Morning by the river';
      document.querySelector('#body').innerHTML = ${JSON.stringify(`<h2>Before dawn</h2><p>I woke <b>early</b> and <i>listened</i>. <a href="https://example.com/x">A link</a>.</p><img src="${px}" alt=""><ul><li>Coffee</li><li>Psalm 46</li></ul><blockquote>Be still, and know.<br>— Psalm 46:10</blockquote><p>After the walk:</p><p><img src="${px2}" alt=""></p><hr><p>Thank you.</p>`)};
      state.current.tags = ['morning', 'stillness']; markDirty(); saveNow(); updateWpButton();`);
    assert.ok(await until(`!document.querySelector('#wpBtn').hidden`), 'button shown');
    assert.equal(await js(`return document.querySelector('#wpBtn').textContent`), 'Post to WordPress');
    await js(`document.querySelector('#wpBtn').click();`);
    assert.ok(await until(`document.querySelector('#wpGo')`), 'post dialog');
    assert.match(await js(`return document.querySelector('.wp-preview').innerText`), /Morning by the river[\s\S]*2 photos/);
    await shot('wp2-post-dialog');
    await js(`document.querySelector('#dlgForm').requestSubmit();`);
    assert.ok(await until(`!document.querySelector('#dlg').open`, 8000), 'sent');
    const ids = Object.keys(wp.posts);
    assert.equal(ids.length, 1);
    const post = wp.posts[ids[0]];
    assert.equal(post.title, 'Morning by the river');
    assert.equal(post.status, 'draft');
    assert.match(post.date, /^\d{4}-\d\d-\d\dT\d\d:\d\d:00$/);
    assert.equal(wp.media.length, 2, 'two photos uploaded');
    assert.equal(post.featured_media, wp.media[0].id, 'first photo is the featured image');
    assert.deepEqual(post.tags.length, 2);
    const c = post.content;
    assert.match(c, /<!-- wp:heading -->\n<h2 class="wp-block-heading">Before dawn<\/h2>/);
    assert.match(c, /<!-- wp:paragraph -->\n<p>I woke <b>early<\/b> and <i>listened<\/i>\. <a href="https:\/\/example.com\/x">A link<\/a>\.<\/p>/);
    assert.match(c, new RegExp(`<!-- wp:image \\{"id":${wp.media[0].id},"sizeSlug":"large","linkDestination":"none"\\} -->\\n<figure class="wp-block-image size-large"><img src="https://example.org/uploads/${wp.media[0].id}.jpg" alt="" class="wp-image-${wp.media[0].id}"/></figure>`));
    assert.match(c, /<!-- wp:list -->\n<ul class="wp-block-list"><!-- wp:list-item -->\n<li>Coffee<\/li>/);
    assert.match(c, /<!-- wp:quote -->\n<blockquote class="wp-block-quote"><!-- wp:paragraph -->\n<p>Be still, and know\.<\/p>\n<!-- \/wp:paragraph --><cite>Psalm 46:10<\/cite><\/blockquote>/);
    assert.match(c, /<!-- wp:separator -->/);
    assert.ok(!c.includes('data:image') && !c.includes('⟦'), 'no inline images or placeholders left');
    assert.equal(await js(`return document.querySelector('#wpBtn').textContent`), 'Update WordPress draft');

    // update: same post, photos not uploaded again, publish now with the week's picture as featured image
    await js(`document.querySelector('#body').insertAdjacentHTML('beforeend', '<p>An extra line.</p>'); markDirty(); saveNow(); document.querySelector('#wpBtn').click();`);
    assert.ok(await until(`document.querySelector('#dlg').open && document.querySelector('#wpGo') && !document.querySelector('#wpGo').disabled`));
    assert.equal(await js(`return document.querySelector('#wpGo').textContent`), 'Update post');
    await js(`document.querySelector('#wpStatus').value = 'publish'; document.querySelector('#wpFeatured').value = 'none'; document.querySelector('#dlgForm').requestSubmit();`);
    assert.ok(await until(`!document.querySelector('#dlg').open`, 8000));
    assert.equal(Object.keys(wp.posts).length, 1, 'same post updated');
    assert.equal(wp.media.length, 2, 'photos not uploaded twice');
    assert.equal(post.status, 'publish');
    assert.equal(post.featured_media, 0);
    assert.match(post.content, /An extra line\./);

    // deleted on the site: a new post is made
    delete wp.posts[ids[0]];
    await js(`document.querySelector('#wpBtn').click();`); assert.ok(await until(`document.querySelector('#dlg').open && document.querySelector('#wpGo') && !document.querySelector('#wpGo').disabled`));
    await js(`document.querySelector('#dlgForm').requestSubmit();`); assert.ok(await until(`!document.querySelector('#dlg').open`, 8000));
    assert.equal(Object.keys(wp.posts).length, 1, 'recreated');

    assert.deepEqual(errors, [], 'no console errors');
    console.log('WordPress e2e passed; shots in', OUT);
    server.close();
    fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
    app.exit(0);
  }).catch(e => { console.error(e); app.exit(1); });
});
