const { isLsCommandLine, extractCsrfToken, extractWindowsPid, parseAppConfig } = require('../src/antigravity/discovery');

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

if (failed) process.exit(1);
console.log('all discovery tests passed');
