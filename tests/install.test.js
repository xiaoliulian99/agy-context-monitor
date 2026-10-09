const {
  HUD_START,
  HUD_END,
  BOOT_START,
  BOOT_END,
  stripBlock,
  hasBlock,
  shouldRefreshBackup,
  bootstrapSource,
  shouldPrompt,
  shouldReveal,
  perCharDelayMs,
  revealLine,
  emitLine,
  INSTALL_INTRO_LINES,
  UNINSTALL_INTRO_LINES,
  chunkHasEnter,
  waitForEnterSync,
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

const bootSrc = bootstrapSource('/usr/local/bin/node', '/repo/src/main.js');
assert(bootSrc.includes("Library', 'Application Support', 'agy-context-monitor'"), 'bootstrap has mac data dir');
assert(bootSrc.includes('LOCALAPPDATA'), 'bootstrap keeps windows data dir');
assert(bootSrc.includes('process.kill'), 'bootstrap checks pid without tasklist');
assert(!bootSrc.includes('tasklist'), 'bootstrap no longer calls tasklist');
const hudSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'injector', 'bootstrap', 'hud.js'), 'utf8');
assert(hudSrc.includes("Library', 'Application Support', 'agy-context-monitor'"), 'hud has mac data dir');
assert(hudSrc.includes('LOCALAPPDATA'), 'hud keeps windows data dir');

// Confirm + reveal gating: TTY without --check/--yes prompts and reveals.
assert(shouldPrompt({ check: false, yes: false, stdinTTY: true, stdoutTTY: true }) === true, 'prompt on TTY');
assert(shouldReveal({ check: false, yes: false, stdinTTY: true, stdoutTTY: true }) === true, 'reveal on TTY');
// --check never prompts or reveals.
assert(shouldPrompt({ check: true, yes: false, stdinTTY: true, stdoutTTY: true }) === false, 'no prompt on --check');
assert(shouldReveal({ check: true, yes: false, stdinTTY: true, stdoutTTY: true }) === false, 'no reveal on --check');
// --yes skips both even on TTY.
assert(shouldPrompt({ check: false, yes: true, stdinTTY: true, stdoutTTY: true }) === false, 'no prompt on --yes');
assert(shouldReveal({ check: false, yes: true, stdinTTY: true, stdoutTTY: true }) === false, 'no reveal on --yes');
// Non-TTY never prompts or reveals.
assert(shouldPrompt({ check: false, yes: false, stdinTTY: false, stdoutTTY: true }) === false, 'no prompt when stdin not TTY');
assert(shouldPrompt({ check: false, yes: false, stdinTTY: true, stdoutTTY: false }) === false, 'no prompt when stdout not TTY');
assert(shouldReveal({ check: false, yes: false, stdinTTY: false, stdoutTTY: false }) === false, 'no reveal when not TTY');

// Slow reveal writes per character and sleeps; immediate writes one line without sleep.
let chunks = [];
let sleeps = 0;
emitLine('hi', { reveal: true, write: (c) => chunks.push(c), sleep: () => { sleeps += 1; }, perCharMs: 5 });
assert(chunks.join('') === 'hi\n', 'reveal writes full text plus newline');
assert(chunks.length === 3, 'reveal writes per character');
assert(sleeps === 2, 'reveal sleeps once per character');

chunks = [];
sleeps = 0;
emitLine('hi', { reveal: false, write: (c) => chunks.push(c), sleep: () => { sleeps += 1; } });
assert(chunks.length === 1 && chunks[0] === 'hi\n', 'immediate writes whole line at once');
assert(sleeps === 0, 'immediate does not sleep');

chunks = [];
sleeps = 0;
revealLine('ok', { write: (c) => chunks.push(c), sleep: () => { sleeps += 1; }, perCharMs: 5 });
assert(chunks.join('') === 'ok\n' && sleeps === 2, 'revealLine writes per character with sleep');

// Per-char budget: short lines stay in 12-20ms, long lines stay under ~700ms total.
const shortMs = perCharDelayMs('[1] test');
assert(shortMs >= 12 && shortMs <= 20, 'short line delay within 12-20ms');
const longLine = `x`.repeat(200);
assert(perCharDelayMs(longLine) * 200 <= 700, 'long line capped around 700ms');

// Confirm copy lives in install.js and covers close/cancel/Enter.
const introAll = INSTALL_INTRO_LINES.join('') + UNINSTALL_INTRO_LINES.join('');
assert(introAll.includes('Antigravity'), 'intro mentions Antigravity');
assert(INSTALL_INTRO_LINES.join('').includes('安装'), 'install intro confirms install');
assert(UNINSTALL_INTRO_LINES.join('').includes('卸载'), 'uninstall intro confirms uninstall');
assert(introAll.includes('Enter'), 'intro uses Enter to confirm');
assert(introAll.includes('Ctrl+C'), 'intro documents Ctrl+C cancel');

// waitForEnter: CR and LF both confirm; extra typing plus Enter still confirms;
// read failure or EOF cancels instead of confirming. Pure logic, no stdin/sleep.
assert(chunkHasEnter(Buffer.from('abc\r', 'utf8')) === true, 'CR confirms');
assert(chunkHasEnter(Buffer.from('abc\n', 'utf8')) === true, 'LF confirms');
assert(chunkHasEnter(Buffer.from('abc', 'utf8'), 3) === false, 'no newline means no confirm');
assert(chunkHasEnter(Buffer.from('\nrest', 'utf8'), 1) === true, 'length-limited chunk confirms');

function feedEnter(chunksOrErrors) {
  let i = 0;
  const calls = [];
  waitForEnterSync((buf) => {
    calls.push(i);
    const item = chunksOrErrors[i];
    i += 1;
    if (item instanceof Error) throw item;
    if (item == null) return 0;
    const src = Buffer.from(item, 'utf8');
    src.copy(buf);
    return src.length;
  });
  return calls.length;
}
assert(feedEnter(['ab', 'c\r\n']) === 2, 'typing plus Enter confirms');
assert((() => { try { feedEnter([new Error('boom')]); return false; } catch (e) { return /已取消/.test(e.message); } })(), 'read error cancels');
assert((() => { try { feedEnter([null]); return false; } catch (e) { return /已取消/.test(e.message); } })(), 'EOF cancels');

// Confirm failure unwinds before closeAntigravity/extractPack/resolveLayout side effects.
const installSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'injector', 'install.js'), 'utf8');
const installBody = installSrc.slice(installSrc.indexOf('function install('), installSrc.indexOf('function uninstall('));
assert(installBody.indexOf('waitForEnter()') < installBody.indexOf('resolveLayout()'), 'install confirms before layout');
assert(installBody.indexOf('waitForEnter()') < installBody.indexOf('closeAntigravity()'), 'install confirms before closeAntigravity');
assert(installBody.indexOf('waitForEnter()') < installBody.indexOf('extractPack('), 'install confirms before extractPack');
const uninstallBody = installSrc.slice(installSrc.indexOf('function uninstall('), installSrc.indexOf('function main('));
assert(uninstallBody.indexOf('waitForEnter()') < uninstallBody.indexOf('resolveLayout()'), 'uninstall confirms before layout');
assert(uninstallBody.indexOf('waitForEnter()') < uninstallBody.indexOf('closeAntigravity()'), 'uninstall confirms before closeAntigravity');
assert(uninstallBody.indexOf('waitForEnter()') < uninstallBody.indexOf('extractPack('), 'uninstall confirms before extractPack');

if (failed) process.exit(1);
console.log('all install tests passed');
