const {
  HUD_START,
  HUD_END,
  BOOT_START,
  BOOT_END,
  stripBlock,
  hasBlock,
  shouldRefreshBackup,
} = require('../injector/install');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const locStart = '/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */';
const locEnd = '/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */';
const mixed = [
  'preload-head();',
  locStart,
  'translate();',
  locEnd,
  HUD_START,
  'drawRing();',
  HUD_END,
  '',
].join('\n');

const stripped = stripBlock(mixed, HUD_START, HUD_END);
assert(!hasBlock(stripped, HUD_START), 'strip HUD marker');
assert(hasBlock(stripped, locStart), 'leave localization intact');
assert(stripped.includes('preload-head();'), 'keep original preload');

const boot = `main();\n${BOOT_START}\nspawnMonitor();\n${BOOT_END}\n`;
assert(!hasBlock(stripBlock(boot, BOOT_START, BOOT_END), BOOT_START), 'strip bootstrap');
assert(hasBlock(boot, BOOT_START), 'hasBlock finds bootstrap');

assert(shouldRefreshBackup(false) === true, 'refresh bak after official update (no HUD)');
assert(shouldRefreshBackup(true) === false, 'keep bak when HUD already present');

if (failed) process.exit(1);
console.log('all install tests passed');
