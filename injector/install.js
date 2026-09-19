#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const child_process = require('child_process');
const { findAntigravityInstallDir } = require('../src/antigravity/discovery');

const HUD_START = '/* --- AGY-CONTEXT-MONITOR HUD START --- */';
const HUD_END = '/* --- AGY-CONTEXT-MONITOR HUD END --- */';
const BOOT_START = '/* --- AGY-CONTEXT-MONITOR BOOTSTRAP START --- */';
const BOOT_END = '/* --- AGY-CONTEXT-MONITOR BOOTSTRAP END --- */';

function argFlag(name) {
  return process.argv.includes(name);
}

function getOptionValue(name) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) return args[i + 1] || '';
    if (args[i].startsWith(name + '=')) return args[i].slice(name.length + 1);
  }
  return '';
}

function run(cmd, opts = {}) {
  try {
    const out = child_process.execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || e.message) };
  }
}

function stripBlock(content, start, end) {
  const i = content.indexOf(start);
  const j = content.indexOf(end);
  if (i === -1 || j === -1 || j < i) return content;
  return (content.slice(0, i) + content.slice(j + end.length)).replace(/\n{3,}/g, '\n\n');
}

function hasBlock(content, start) {
  return content.includes(start);
}

function shouldRefreshBackup(currentHasHud) {
  return !currentHasHud;
}

function isAntigravityRunningSync() {
  try {
    const stdout = child_process.execSync('tasklist /fi "imagename eq Antigravity.exe" /nh', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return stdout.toLowerCase().includes('antigravity.exe');
  } catch (_) {
    return false;
  }
}

function closeAntigravity() {
  for (let i = 0; i < 8; i++) {
    try {
      child_process.execSync('taskkill /f /im Antigravity.exe /t', { stdio: 'ignore' });
    } catch (_) { /* not running */ }
    const t = Date.now();
    while (Date.now() - t < 400) { /* wait */ }
    if (!isAntigravityRunningSync()) break;
  }
  const t2 = Date.now();
  while (Date.now() - t2 < 800) { /* wait for file unlock */ }
}

function startMonitor(nodePath, scriptPath) {
  const dir = path.join(process.env.LOCALAPPDATA || '', 'agy-context-monitor');
  fs.mkdirSync(dir, { recursive: true });
  const pidFile = path.join(dir, 'monitor.pid');
  if (fs.existsSync(pidFile)) {
    const old = parseInt(String(fs.readFileSync(pidFile, 'utf8')).trim(), 10);
    if (old > 0) {
      try { child_process.execSync(`taskkill /f /pid ${old} /t`, { stdio: 'ignore' }); } catch (_) { /* gone */ }
    }
  }
  const child = child_process.spawn(nodePath, [scriptPath, '--watch'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  fs.writeFileSync(pidFile, String(child.pid), 'utf8');
  child.unref();
}

function launchAntigravity(installDir) {
  const exe = path.join(installDir, 'Antigravity.exe');
  if (!fs.existsSync(exe)) {
    console.log('[启动] 未找到 Antigravity.exe，请手动打开。');
    return;
  }
  try {
    child_process.spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    console.log('[启动] 已重新打开 Antigravity。');
  } catch (e) {
    console.log('[启动] 自动打开失败，请手动打开。', e.message);
  }
}

function findNode() {
  try {
    const out = child_process.execSync('where.exe node', { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch (_) { /* fall through */ }
  const fallbacks = [
    'C:\\Program Files\\nodejs\\node.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
  ];
  for (const fallback of fallbacks) {
    if (fallback && fs.existsSync(fallback)) return fallback;
  }
  return null;
}

function prependNodeDirToPath(nodePath) {
  if (!nodePath) return;
  const dir = path.dirname(nodePath);
  const cur = process.env.PATH || '';
  if (!cur.toLowerCase().split(path.delimiter).includes(dir.toLowerCase())) {
    process.env.PATH = dir + path.delimiter + cur;
  }
}

function asarBin() {
  const nodePath = findNode();
  prependNodeDirToPath(nodePath);
  const npxCmd = nodePath ? path.join(path.dirname(nodePath), 'npx.cmd') : '';
  const npx = npxCmd && fs.existsSync(npxCmd) ? `"${npxCmd}"` : 'npx';
  return `${npx} -y @electron/asar`;
}

function bootstrapSource(nodePath, scriptPath) {
  const nodeLit = JSON.stringify(nodePath);
  const scriptLit = JSON.stringify(scriptPath);
  return `${BOOT_START}
(() => {
  try {
    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(process.env.LOCALAPPDATA || '', 'agy-context-monitor');
    const statusFile = path.join(dir, 'status.json');
    const activeFile = path.join(dir, 'active-cascade.json');
    try {
      const { ipcMain } = require('electron');
      ipcMain.removeAllListeners('agy-ctx-read-status');
      ipcMain.on('agy-ctx-read-status', (event) => {
        try { event.returnValue = fs.readFileSync(statusFile, 'utf8'); }
        catch (_) { event.returnValue = ''; }
      });
      ipcMain.removeAllListeners('agy-ctx-write-active');
      ipcMain.on('agy-ctx-write-active', (event, payload) => {
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(activeFile, String(payload || ''), 'utf8');
          event.returnValue = true;
        } catch (_) { event.returnValue = false; }
      });
    } catch (_) { /* ipc optional */ }
    const pidFile = path.join(dir, 'monitor.pid');
    fs.mkdirSync(dir, { recursive: true });
    let running = false;
    if (fs.existsSync(pidFile)) {
      const old = parseInt(String(fs.readFileSync(pidFile, 'utf8')).trim(), 10);
      if (old > 0) {
        try {
          const { execSync } = require('child_process');
          const out = execSync('tasklist /fi "PID eq ' + old + '" /nh', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          running = out.includes(String(old)) && /node/i.test(out);
        } catch (_) { running = false; }
      }
    }
    if (running) return;
    const child = spawn(${nodeLit}, [${scriptLit}, '--watch'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    fs.writeFileSync(pidFile, String(child.pid), 'utf8');
    child.unref();
  } catch (_) { /* never break Antigravity */ }
})();
${BOOT_END}
`;
}

function copyAsarUnlocked(src, dest) {
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      fs.copyFileSync(src, dest);
      return;
    } catch (e) {
      lastErr = e;
      console.log('[警告] app.asar 被占用，重试关闭 Antigravity...', e.message);
      closeAntigravity();
    }
  }
  throw new Error('write app.asar failed (locked): ' + (lastErr && lastErr.message));
}

function extractPack(asarPath, tempDir, pack) {
  const bin = asarBin();
  if (!pack) {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    const res = run(`${bin} extract "${asarPath}" "${tempDir}"`);
    if (!res.ok) throw new Error('asar extract failed: ' + res.out);
    return;
  }
  const packed = asarPath + '.agy-new';
  const res = run(`${bin} pack "${tempDir}" "${packed}"`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (!res.ok) {
    if (fs.existsSync(packed)) fs.unlinkSync(packed);
    throw new Error('asar pack failed: ' + res.out);
  }
  copyAsarUnlocked(packed, asarPath);
  fs.unlinkSync(packed);
}

function extractInnerFile(asarPath, innerFile, destFile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-asar-file-'));
  try {
    const res = run(`${asarBin()} extract-file "${asarPath}" "${innerFile}"`, { cwd: tmp });
    const extracted = path.join(tmp, path.basename(innerFile));
    if (!res.ok || !fs.existsSync(extracted)) {
      throw new Error('asar extract-file failed: ' + (res.out || innerFile));
    }
    fs.mkdirSync(path.dirname(destFile), { recursive: true });
    fs.copyFileSync(extracted, destFile);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function resolveInstallDir() {
  const fromArg = getOptionValue('--install-dir');
  if (fromArg) process.env.ANTIGRAVITY_INSTALL_DIR = fromArg;
  const installDir = findAntigravityInstallDir();
  if (!installDir) throw new Error('Antigravity install dir not found. 可用 --install-dir 或环境变量 ANTIGRAVITY_INSTALL_DIR 指定。');
  return installDir;
}

function resourcesDir() {
  return path.join(resolveInstallDir(), 'resources');
}

function readAsarVersion(asarPath) {
  const dest = path.join(os.tmpdir(), 'agy-asar-pkg.json');
  try {
    extractInnerFile(asarPath, 'package.json', dest);
    const v = JSON.parse(fs.readFileSync(dest, 'utf8')).version;
    return v || '';
  } catch (_) {
    return '';
  } finally {
    try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
  }
}

function asarHasHud(asarPath) {
  const dest = path.join(os.tmpdir(), 'agy-asar-preload-check.js');
  try {
    extractInnerFile(asarPath, 'dist/preload.js', dest);
    return hasBlock(fs.readFileSync(dest, 'utf8'), HUD_START);
  } finally {
    try { fs.unlinkSync(dest); } catch (_) { /* ignore */ }
  }
}

function refreshBackup(asarPath, ownBak) {
  const currentHasHud = asarHasHud(asarPath);
  const bakExists = fs.existsSync(ownBak);
  if (!shouldRefreshBackup(currentHasHud)) {
    console.log('[备份] 当前包已含圆环，保留既有 app.asar.agy-context.bak');
    return;
  }
  fs.copyFileSync(asarPath, ownBak);
  console.log(bakExists
    ? '[备份] 官方包已更新，已刷新 app.asar.agy-context.bak'
    : '[备份] 已创建 app.asar.agy-context.bak');
}

function check() {
  const resources = resourcesDir();
  const asarPath = path.join(resources, 'app.asar');
  const tmpPre = path.join(os.tmpdir(), 'agy-check-preload.js');
  const tmpMain = path.join(os.tmpdir(), 'agy-check-main.js');
  extractInnerFile(asarPath, 'dist/preload.js', tmpPre);
  extractInnerFile(asarPath, 'dist/main.js', tmpMain);
  const preload = fs.readFileSync(tmpPre, 'utf8');
  const mainJs = fs.readFileSync(tmpMain, 'utf8');
  fs.unlinkSync(tmpPre);
  fs.unlinkSync(tmpMain);
  const hud = hasBlock(preload, HUD_START);
  const boot = hasBlock(mainJs, BOOT_START);
  const version = readAsarVersion(asarPath);
  console.log('installDir', path.dirname(resources));
  if (version) console.log('version', version);
  console.log('hud', hud ? 'present' : 'missing');
  console.log('bootstrap', boot ? 'present' : 'missing');
  return hud && boot;
}

function install() {
  const installDir = resolveInstallDir();
  const resources = path.join(installDir, 'resources');
  const asarPath = path.join(resources, 'app.asar');
  const ownBak = path.join(resources, 'app.asar.agy-context.bak');
  const hudPath = path.join(__dirname, 'bootstrap', 'hud.js');
  const monitorScript = path.resolve(__dirname, '..', 'src', 'main.js');
  const nodePath = findNode();
  if (!fs.existsSync(hudPath)) throw new Error('missing hud.js');
  if (!fs.existsSync(monitorScript)) throw new Error('missing src/main.js');
  if (!nodePath) throw new Error('node.exe not found');

  const version = readAsarVersion(asarPath);
  console.log('[探测] Antigravity', installDir, version ? `(${version})` : '');
  const wasRunning = isAntigravityRunningSync();
  console.log('[1] 正在关闭 Antigravity 以解锁 app.asar...');
  closeAntigravity();

  refreshBackup(asarPath, ownBak);

  const tempDir = path.join(os.tmpdir(), 'agy-context-asar');
  console.log('[解包] 正在提取 app.asar...');
  extractPack(asarPath, tempDir, false);

  const preloadPath = path.join(tempDir, 'dist', 'preload.js');
  const mainPath = path.join(tempDir, 'dist', 'main.js');
  if (!fs.existsSync(preloadPath) || !fs.existsSync(mainPath)) {
    throw new Error('dist/preload.js or dist/main.js missing inside asar');
  }

  let preload = stripBlock(fs.readFileSync(preloadPath, 'utf8'), HUD_START, HUD_END);
  preload = preload.trimEnd() + '\n' + fs.readFileSync(hudPath, 'utf8') + '\n';
  fs.writeFileSync(preloadPath, preload, 'utf8');

  let mainJs = stripBlock(fs.readFileSync(mainPath, 'utf8'), BOOT_START, BOOT_END);
  mainJs = mainJs.trimEnd() + '\n' + bootstrapSource(nodePath, monitorScript);
  fs.writeFileSync(mainPath, mainJs, 'utf8');

  console.log('[打包] 正在写回 app.asar...');
  extractPack(asarPath, tempDir, true);
  if (!asarHasHud(asarPath)) {
    throw new Error('asar wrote but HUD marker missing; inject aborted');
  }
  console.log('[√] 已注入 HUD 到 dist/preload.js');
  console.log('[√] 已注入 bootstrap 到 dist/main.js');
  startMonitor(nodePath, monitorScript);
  console.log('[监控]', nodePath, monitorScript, '--watch');
  launchAntigravity(installDir);
}

function uninstall() {
  const installDir = resolveInstallDir();
  const resources = path.join(installDir, 'resources');
  const asarPath = path.join(resources, 'app.asar');
  console.log('[探测] Antigravity', installDir);
  const wasRunning = isAntigravityRunningSync();
  console.log('[1] 正在关闭 Antigravity 以解锁 app.asar...');
  closeAntigravity();
  const tempDir = path.join(os.tmpdir(), 'agy-context-asar');
  extractPack(asarPath, tempDir, false);
  const preloadPath = path.join(tempDir, 'dist', 'preload.js');
  const mainPath = path.join(tempDir, 'dist', 'main.js');
  fs.writeFileSync(preloadPath, stripBlock(fs.readFileSync(preloadPath, 'utf8'), HUD_START, HUD_END), 'utf8');
  fs.writeFileSync(mainPath, stripBlock(fs.readFileSync(mainPath, 'utf8'), BOOT_START, BOOT_END), 'utf8');
  extractPack(asarPath, tempDir, true);
  console.log('[√] 已移除圆环与启动器；汉化包未改动');
  if (wasRunning) launchAntigravity(installDir);
}

function main() {
  try {
    if (argFlag('--check')) {
      process.exit(check() ? 0 : 2);
    }
    if (argFlag('--uninstall')) {
      uninstall();
      return;
    }
    install();
  } catch (err) {
    console.error('[错误]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  HUD_START,
  HUD_END,
  BOOT_START,
  BOOT_END,
  stripBlock,
  hasBlock,
  shouldRefreshBackup,
  findNode,
};
