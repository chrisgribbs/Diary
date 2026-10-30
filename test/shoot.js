'use strict';
// Drives the real app in a hidden display and saves screenshots.
// Run: xvfb-run -a npx electron --no-sandbox test/shoot.js <outdir> [dark]
const path = require('path');
const fs = require('fs');
const os = require('os');
const OUT = path.resolve(process.argv.slice(2).find(a => !a.startsWith('-') && a !== 'dark' && !a.endsWith('.js')) || 'shots');
const DARK = process.argv.includes('dark');
fs.mkdirSync(OUT, { recursive: true });
process.env.WELLWRITE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-shot-'));
if (DARK) fs.writeFileSync(path.join(process.env.WELLWRITE_DATA_DIR, 'settings.json'), JSON.stringify({ theme: 'dark' }));

const { app } = require('electron');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-profile-'))); // fresh browser storage each run
const { getWindow } = require('../main.js');
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

async function shot(name) {
  await wait(400);
  const img = await getWindow().webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  console.log('shot', name);
}

app.whenReady().then(async () => {
  while (!getWindow()) await wait(50);
  const win = getWindow();
  win.setSize(1280, 820);
  win.webContents.on('console-message', (e) => {
    const lvl = e.level ?? e.params?.level; const msg = e.message ?? e.params?.message;
    if (lvl === 'error' || lvl === 3) errors.push(msg);
  });
  await new Promise(r => win.webContents.once('did-finish-load', r));
  const js = code => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  await wait(500);
  await shot('1-setup');

  await js(`
    document.querySelector('#setupPw').value = 'river-stone';
    document.querySelector('#setupPw2').value = 'river-stone';
    document.querySelector('#setupForm').requestSubmit();
  `);
  await wait(2500);
  await shot('2-first-run');
  await js(`document.querySelector('.sidetabs [data-view=categories]').click();`);
  await shot('2b-empty-categories');
  await js(`document.querySelector('.sidetabs [data-view=tags]').click();`);
  await shot('2c-empty-tags');
  await js(`document.querySelector('.sidetabs [data-view=calendar]').click();`);

  // Seed some entries through the real API, with a generated photo.
  await js(`
    const c = document.createElement('canvas'); c.width = 900; c.height = 560;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0,0,0,560); grd.addColorStop(0,'#9db7cf'); grd.addColorStop(.62,'#e9d6b4'); grd.addColorStop(.63,'#4c6b5a'); grd.addColorStop(1,'#2f4a3d');
    g.fillStyle = grd; g.fillRect(0,0,900,560);
    g.fillStyle = '#f6e3a8'; g.beginPath(); g.arc(640,300,46,0,7); g.fill();
    g.fillStyle = '#3b5747'; g.beginPath(); g.moveTo(0,380); g.lineTo(220,250); g.lineTo(420,360); g.lineTo(600,280); g.lineTo(900,390); g.lineTo(900,560); g.lineTo(0,560); g.fill();
    const img = c.toDataURL('image/jpeg', .85);
    const iso = d => d.toISOString().slice(0,10);
    const day = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
    const lastYear = (() => { const d = new Date(); d.setFullYear(d.getFullYear()-1); return day(0).replace(/^\\d{4}/, d.getFullYear()); })();
    const E = [
      { date: day(0), time: '07:42', title: 'Rain over the canal', tags: ['morning','bangkok'],
        html: '<p>Woke before the alarm to the sound of rain on the tin roof next door. The canal was the colour of strong tea, and a man in a long-tail boat was bailing water with a cut-off bottle, patient as anything.</p><p>I want to remember <mark>how quiet the city gets</mark> for the first ten minutes of a downpour. Even the motorbikes pull over.</p><h2>Things to do this week</h2><ul><li>Call Mum about the flights</li><li>Finish the second chapter edits</li><li>Return the borrowed umbrella, finally</li></ul><blockquote>Not everything has to be productive. Some mornings are just for watching.</blockquote>' },
      { date: day(1), time: '21:10', title: 'Hills at dusk', tags: ['travel','photos'], html: '<p>Drove out past the reservoir to catch the last light.</p><img src="'+img+'" alt=""><p>The photo doesn\\'t get the smell of cut grass.</p>' },
      { date: day(2), time: '22:05', title: 'A hard conversation', tags: ['work'], html: '<p>Told P. that I can\\'t take on the extra project. Expected it to go badly. It didn\\'t. Wrote down what I said so I can do it again next time.</p>' },
      { date: day(3), time: '', title: '', tags: [], html: '<p>Couldn\\'t sleep. Made jasmine tea and listened to the fridge hum. Small, fine night.</p>' },
      { date: day(6), time: '08:30', title: 'Market list and a recipe', tags: ['food'], html: '<p>Green papaya, limes, dried shrimp, palm sugar. Aunt Noi says the trick is pounding the garlic and chilli first, then barely bruising the papaya.</p>' },
      { date: day(12), time: '18:00', title: 'First swim of the season', tags: ['health','morning'], html: '<p>Twenty lengths. Shoulders burning. Worth it.</p>' },
      { date: day(19), time: '09:00', title: 'Reading notes', tags: ['books'], html: '<p>Finished the novel about the lighthouse keeper. The ending was quieter than I wanted, and better for it.</p>' },
      { date: lastYear, time: '10:00', title: 'One year in the new flat', tags: ['home'], html: '<p>Still haven\\'t hung the pictures.</p>' },
    ];
    for (const e of E) {
      const d = document.createElement('div'); d.innerHTML = e.html;
      await window.wellwrite.save({ ...e, text: d.innerText || d.textContent });
    }
  `);
  // Re-enter so the app loads the seeded entries.
  await js(`document.querySelector('#lockBtn').click();`);
  await wait(800);
  await shot('3-unlock');
  await js(`
    document.querySelector('#unlockPw').value = 'wrong';
    document.querySelector('#unlockForm').requestSubmit();
  `);
  await wait(1800);
  await shot('3b-wrong-password');
  await js(`document.querySelector('#unlockPw').value = 'river-stone'; document.querySelector('#unlockForm .pw-eye').click();`);
  await wait(200);
  const shown = await js(`return document.querySelector('#unlockPw').type`);
  await shot('3c-show-password');
  await js(`document.querySelector('#unlockForm .pw-eye').click();`);
  console.log('reveal toggles:', shown, '->', await js(`return document.querySelector('#unlockPw').type`));
  await js(`
    document.querySelector('#unlockPw').value = 'river-stone';
    document.querySelector('#unlockForm').requestSubmit();
  `);
  await wait(2200);
  await shot('4-today');

  await js(`document.querySelectorAll('#list .item')[1].click();`);
  await wait(800);
  await shot('5-photo-entry');

  await js(`const s = document.querySelector('#search'); s.value = 'tea'; s.dispatchEvent(new Event('input'));`);
  await wait(600);
  await shot('6-search');

  // Typing in a new entry, autosave, tags
  await js(`
    const s = document.querySelector('#search'); s.value = ''; s.dispatchEvent(new Event('input'));
    document.querySelector('#newBtn').click();
  `);
  await wait(500);
  win.webContents.focus();
  await js(`document.querySelector('#title').focus();`);
  await win.webContents.insertText('Testing the keyboard');
  await js(`document.querySelector('#body').focus();`);
  await win.webContents.insertText('Typed through the real input path. ');
  await js(`const t = document.querySelector('#tagInput'); t.focus(); t.value = 'test, keyboard'; t.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}));`);
  await wait(1500);
  const saved = await js(`return { state: document.querySelector('#saveState').textContent, n: (await window.wellwrite.list()).length, chips: document.querySelectorAll('.chip').length };`);
  console.log('autosave', JSON.stringify(saved));

  await shot('6b-backup-card');
  await js(`document.querySelector('#backupCard .btn-foil').click();`);
  await wait(700);
  await shot('7-settings-backups');
  // Turn on automatic backups to a folder and back up now.
  const bdir = path.join(process.env.WELLWRITE_DATA_DIR, '..', 'wellwrite-shot-usb-' + process.pid);
  fs.mkdirSync(bdir, { recursive: true });
  // Set the folder in the settings file, as the folder picker would.
  const sf = path.join(process.env.WELLWRITE_DATA_DIR, 'settings.json');
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}
  fs.writeFileSync(sf, JSON.stringify({ ...cur, backupDir: bdir }));
  await js(`await window.wellwrite.setSettings({ backupToFolder: true }); await refreshBackupInfo();`);
  await wait(300);
  await js(`document.querySelector('.backup-status button').click();`);
  await wait(1500);
  await shot('7b-backed-up-folder');
  console.log('folder backups:', fs.readdirSync(bdir));
  fs.rmSync(bdir, { recursive: true, force: true });
  await js(`document.querySelector('#dlg').close();`);

  // Lock wipes the page
  await js(`document.querySelector('#lockBtn').click();`);
  await wait(800);
  const leaked = await js(`return document.body.innerText.includes('canal') || document.querySelector('#body').innerHTML.length;`);
  console.log('after lock, content visible:', leaked);

  console.log('console errors:', errors.length ? errors : 'none');
  fs.rmSync(process.env.WELLWRITE_DATA_DIR, { recursive: true, force: true });
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
