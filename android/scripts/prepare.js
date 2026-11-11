'use strict';
// Gets the Android project ready to build:
//   app/src/main/assets/www             the page (renderer/), exactly as on Windows
//   app/src/main/assets/nodejs-project  the engine: android/node/main.js, src/, bible/, package.json
//   app/libnode                         Node.js for Android (from the nodejs-mobile npm package), if missing
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'android', 'app');
const ASSETS = path.join(APP, 'src', 'main', 'assets');
const NODE_MOBILE = 'nodejs-mobile-react-native@18.20.4';

function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    if (skip(name, a)) continue;
    if (fs.statSync(a).isDirectory()) copyDir(a, b, skip);
    else fs.copyFileSync(a, b);
  }
}

fs.rmSync(ASSETS, { recursive: true, force: true });
copyDir(path.join(ROOT, 'renderer'), path.join(ASSETS, 'www'));

const project = path.join(ASSETS, 'nodejs-project');
copyDir(path.join(ROOT, 'src'), path.join(project, 'src'));
copyDir(path.join(ROOT, 'bible'), path.join(project, 'bible'));
fs.copyFileSync(path.join(ROOT, 'android', 'node', 'main.js'), path.join(project, 'main.js'));
const pkg = require(path.join(ROOT, 'package.json'));
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, main: 'main.js' }, null, 2));

const libnode = path.join(APP, 'libnode');
if (!fs.existsSync(path.join(libnode, 'bin', 'arm64-v8a', 'libnode.so'))) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libnode-'));
  console.log('Fetching Node.js for Android (' + NODE_MOBILE + ')…');
  const tgz = execFileSync('npm', ['pack', NODE_MOBILE, '--silent'], { cwd: tmp, encoding: 'utf8' }).trim().split('\n').pop();
  execFileSync('tar', ['xzf', tgz, 'package/android/libnode'], { cwd: tmp });
  fs.rmSync(libnode, { recursive: true, force: true });
  fs.cpSync(path.join(tmp, 'package', 'android', 'libnode'), libnode, { recursive: true });   // not rename: /tmp may be another disk
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('Android project ready: WellWrite ' + pkg.version);
