const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isLsCommandLine,
  extractCsrfToken,
  extractWindowsPid,
  parseAppConfig,
  parseMacPsLines,
  parseLsofListenPorts,
  inspectAntigravityPath,
  installCandidateDirs,
} = require('../src/antigravity/discovery');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

assert(isLsCommandLine('"16696","language_server.exe",'), 'csv line without command line still matches LS');
assert(isLsCommandLine('C:\\Programs\\antigravity\\resources\\bin\\language_server.exe --csrf_token abc'), 'full command line matches');
assert(!isLsCommandLine('notepad.exe'), 'unrelated process ignored');

assert(extractWindowsPid('"16696","language_server.exe",') === 16696, 'pid from csv without command line');
assert(extractCsrfToken('"16696","language_server.exe",') === null, 'no csrf when command line empty');
assert(extractCsrfToken('--csrf_token a27f13f3-2cd3-41e3-807c-ba6dc57a603c --app_data_dir antigravity') === 'a27f13f3-2cd3-41e3-807c-ba6dc57a603c', 'csrf from spawn args');

const cfg = parseAppConfig('<script>window.__APP_CONFIG__ = {"productName":"antigravity","csrfToken":"abc-def","appVersion":"2.12.2","devMode":false};</script>');
assert(cfg && cfg.csrfToken === 'abc-def', 'parse csrf from app config');
assert(cfg.productName === 'antigravity', 'parse product name');
assert(parseAppConfig('<html></html>') === null, 'missing app config');

const macPs = [
  '431 /Applications/Antigravity.app/Contents/Resources/app/bin/language_server --csrf_token abc-def --app_data_dir antigravity',
  '900 /Applications/Cursor.app/Contents/Resources/app/bin/language_server --csrf_token nope',
  '12 language_server.exe',
].join('\n');
const macProcs = parseMacPsLines(macPs);
assert(macProcs.length === 1 && macProcs[0].pid === 431, 'mac ps keeps only antigravity language_server');
assert(macProcs[0].csrfToken === 'abc-def', 'mac ps csrf');

const lsof = [
  'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
  'language_se 431 user 12u IPv4 0x1 0t0 TCP 127.0.0.1:53421 (LISTEN)',
  'language_se 431 user 13u IPv6 0x2 0t0 TCP *:53422 (LISTEN)',
  'language_se 431 user 14u IPv4 0x3 0t0 TCP 192.168.1.9:80 (LISTEN)',
  'language_se 431 user 15u IPv6 0x4 0t0 TCP [::1]:53423 (LISTEN)',
].join('\n');
assert(JSON.stringify(parseLsofListenPorts(lsof)) === JSON.stringify([53421, 53422, 53423]), 'lsof loopback ports only');

const macRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-mac-app-'));
const app = path.join(macRoot, 'Antigravity.app');
fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Antigravity'), '');
fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'app.asar'), '');
const fromApp = inspectAntigravityPath(app);
assert(fromApp && fromApp.appBundle === path.resolve(app), 'mac .app layout');
assert(fromApp.resourcesDir === path.join(path.resolve(app), 'Contents', 'Resources'), 'mac resources dir');
const fromContents = inspectAntigravityPath(path.join(app, 'Contents'));
assert(fromContents && fromContents.installDir === path.resolve(app), 'mac Contents normalizes to .app');

const winRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-win-app-'));
fs.mkdirSync(path.join(winRoot, 'resources'), { recursive: true });
fs.writeFileSync(path.join(winRoot, 'Antigravity.exe'), '');
fs.writeFileSync(path.join(winRoot, 'resources', 'app.asar'), '');
const winLayout = inspectAntigravityPath(winRoot);
assert(winLayout && winLayout.appBundle === null, 'windows layout has no app bundle');
assert(winLayout.executable === path.join(path.resolve(winRoot), 'Antigravity.exe'), 'windows executable');

const macCandidates = installCandidateDirs('darwin', {}, '/Users/a');
assert(macCandidates.includes('/Applications/Antigravity.app'), 'mac default app candidate');
assert(macCandidates.includes(path.join('/Users/a', 'Applications', 'Antigravity IDE.app')), 'mac home IDE candidate');
assert(!macCandidates.some((dir) => dir.includes('Program Files')), 'mac candidates skip windows paths');

if (failed) process.exit(1);
console.log('all discovery tests passed');
