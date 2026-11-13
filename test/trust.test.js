'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Vault } = require('../src/vault');
const { Trust, HOUR } = require('../src/trust');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wellwrite-trust-'));
const v = new Vault(path.join(tmp, 'j')); v.create('river-stone');
v.save({ date: '2026-10-31', title: 'Hello', html: '', text: '' });
const key = Buffer.from(v.key);
let clock = 1_000_000;
let available = true;
const t = new Trust({ file: path.join(tmp, 'trusted.json'), available: () => available, now: () => clock,
  protect: s => 'p:' + Buffer.from(s).toString('hex'), unprotect: s => Buffer.from(s.slice(2), 'hex').toString() });

assert.deepEqual(t.status(), { mode: 'ask', active: false, available: true });
assert.equal(t.key(), null);

// one hour
t.save('hour', key);
assert.equal(t.status().active, true);
assert.equal(t.status().until, clock + HOUR);
assert(!fs.readFileSync(path.join(tmp, 'trusted.json'), 'utf8').includes(key.toString('base64')), 'key not stored as-is');
assert(t.key().equals(key));
v.lock(); v.unlockWithKey(t.key()); assert.equal(v.list()[0].title, 'Hello', 'remembered key opens the journal');
clock += HOUR - 1000; assert(t.key(), 'still valid just before the hour');
clock += 2000; assert.equal(t.status().active, false); assert.equal(t.status().expired, true); assert.equal(t.key(), null, 'expired');
t.refresh(key); assert.equal(t.status().active, true, 'typing the password starts a new hour');

// trust this computer: no expiry
t.save('trust', key);
clock += 365 * 24 * HOUR;
assert(t.key().equals(key));

// a different journal (e.g. restored from someone else's backup) doesn't match
const other = new Vault(path.join(tmp, 'k')); other.create('different');
fs.writeFileSync(path.join(tmp, 'trusted.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(tmp, 'trusted.json'))), key: 'p:' + Buffer.from(Buffer.from(other.key).toString('base64')).toString('hex') }));
assert.equal(t.key(), null, 'mismatched key rejected');
assert.equal(t.status().active, false, 'and forgotten');

// for a week: no password for seven days, then it's asked for again; typing it starts another week
t.save('week', key);
clock += 6 * 24 * HOUR;
assert.equal(t.status().active, true, 'still trusted after 6 days');
assert.ok(t.key() && t.key().equals(key));
clock += 25 * HOUR;
assert.equal(t.status().active, false, 'asks again after a week');
assert.equal(t.status().mode, 'week');
t.refresh(key);
assert.equal(t.status().active, true, 'password typed: another week');
t.save('day', key); clock += 23 * HOUR; assert.equal(t.status().active, true); clock += 2 * HOUR; assert.equal(t.status().active, false, 'a day');

// turning it off, and when Windows can't protect keys
t.save('trust', key); t.save('ask', key);
assert.equal(t.status().active, false); assert(!fs.existsSync(path.join(tmp, 'trusted.json')));
available = false;
assert.throws(() => t.save('trust', key), /can’t protect/);
assert.equal(t.status().available, false);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('trust tests passed');
