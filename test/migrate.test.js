'use strict';
// Moving the journal from the Daybook folder to the WellWrite folder.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault } = require('../src/vault');
const { migrateJournal } = require('../src/migrate');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-mig-'));
const appData = path.join(tmp, 'AppData', 'Roaming');
const oldDir = path.join(appData, 'Daybook', 'journal');
const newDir = path.join(appData, 'WellWrite', 'journal');

// Fresh install: nothing to do.
assert.equal(migrateJournal(oldDir, newDir), 'none');
assert(!fs.existsSync(newDir));

// A Daybook journal with entries, settings and backup history.
const v = new Vault(oldDir);
v.create('river-stone');
v.save({ date: '2026-10-30', title: 'Before the rename', html: '<p>hi</p>', text: 'hi' });
v.lock();
fs.writeFileSync(path.join(oldDir, 'settings.json'), JSON.stringify({ backupToFolder: true, backupDir: 'E:\\Backups' }));
fs.writeFileSync(path.join(oldDir, 'backup-status.json'), '{"folder":{"lastAt":"2026-10-30T00:00:00Z"}}');
// Electron caches that stay behind in the old app folder.
fs.mkdirSync(path.join(appData, 'Daybook', 'Cache'), { recursive: true });
// The new app already wrote a settings-only folder (e.g. a crash before the move).
fs.mkdirSync(newDir, { recursive: true });
fs.writeFileSync(path.join(newDir, 'settings.json'), '{}');

assert.equal(migrateJournal(oldDir, newDir), 'moved');
assert(!fs.existsSync(oldDir), 'journal moved, not copied');
assert(fs.existsSync(path.join(appData, 'Daybook', 'Your journal has moved.txt')));
assert(fs.readdirSync(path.join(appData, 'WellWrite')).some(n => n.startsWith('journal-before-move-')), 'settings-only folder set aside');
assert.equal(JSON.parse(fs.readFileSync(path.join(newDir, 'settings.json'), 'utf8')).backupDir, 'E:\\Backups');
assert(fs.existsSync(path.join(newDir, 'backup-status.json')));
const w = new Vault(newDir);
assert(w.unlock('river-stone'));
assert.equal(w.list()[0].title, 'Before the rename');
w.lock();

// Second launch: already moved, nothing happens.
assert.equal(migrateJournal(oldDir, newDir), 'skipped');

// Never overwrites: if both exist, the new one wins and the old one is left alone.
const v2 = new Vault(oldDir); v2.create('other-pass'); v2.lock();
assert.equal(migrateJournal(oldDir, newDir), 'skipped');
assert(fs.existsSync(path.join(oldDir, 'vault.json')));
assert(new Vault(newDir).unlock('river-stone'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('migrate tests passed');
