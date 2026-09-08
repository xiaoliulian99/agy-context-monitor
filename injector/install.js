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

function run(cmd) {
  try {
    const out = child_process.execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
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

function closeAntigravity() {
  try {
    child_process.execSync('taskkill /f /im Antigravity.exe /t', { stdio: 'ignore' });
  } catch (_) { /* not running */ }
  const t = Date.now();
  while (Date.now() - t < 1500) { /* wait for file unlock */ }
}

function findNode() {
  try {
    const out = child_process.execSync('where.exe node', { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) return out;
  } catch (_) { /* fall through */ }
  const fallback = 'C:\\Program Files\\nodejs\\node.exe';
  return fs.existsSync(fallback) ? fallback : null;
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
    try {
      const { ipcMain } = require('electron');
      ipcMain.removeAllListeners('agy-ctx-read-status');
      ipcMain.on('agy-ctx-read-status', (event) => {
        try { event.returnValue = fs.readFileSync(statusFile, 'utf8'); }
        catch (_) { event.returnValue = ''; }
      });
    } catch (_) { /* ipc optional */ }
    const pidFile = path.join(dir, 'monitor.pid');
    fs.mkdirSync(dir, { recursive: true });
    let running = false;
    if (fs.existsSync(pidFile)) {
      const old = parseInt(String(fs.readFileSync(pidFile, 'utf8')).trim(), 10);
      if (old > 0) {
        try { process.kill(old, 0); running = true; } catch (_) { running = false; }
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

function extractPack(asarPath, tempDir, pack) {
  const asarBin = 'npx -y @electron/asar';
  if (!pack) {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    const res = run(`${asarBin} extract "${asarPath}" "${tempDir}"`);
    if (!res.ok) throw new Error('asar extract failed: ' + res.out);
    return;
  }
  const packed = asarPath + '.agy-new';
  const res = run(`${asarBin} pack "${tempDir}" "${packed}"`);
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (!res.ok) {
    if (fs.existsSync(packed)) fs.unlinkSync(packed);
    throw new Error('asar pack failed: ' + res.out);
  }
  fs.copyFileSync(packed, asarPath);
  fs.unlinkSync(packed);
}

function resourcesDir() {
  const installDir = findAntigravityInstallDir();
  if (!installDir) throw new Error('Antigravity install dir not found');
  return path.join(installDir, 'resources');
}

function check() {
  const resources = resourcesDir();
  const asarPath = path.join(resources, 'app.asar');
  const tempDir = path.join(os.tmpdir(), 'agy-context-asar-check');
  extractPack(asarPath, tempDir, false);
  const preload = fs.readFileSync(path.join(tempDir, 'dist', 'preload.js'), 'utf8');
  const mainJs = fs.readFileSync(path.join(tempDir, 'dist', 'main.js'), 'utf8');
  fs.rmSync(tempDir, { recursive: true, force: true });
  const hud = hasBlock(preload, HUD_START);
  const boot = hasBlock(mainJs, BOOT_START);
  console.log('installDir', path.dirname(resources));
  console.log('hud', hud ? 'present' : 'missing');
  console.log('bootstrap', boot ? 'present' : 'missing');
  return hud && boot;
}

function install() {
  const resources = resourcesDir();
  const asarPath = path.join(resources, 'app.asar');
  const ownBak = path.join(resources, 'app.asar.agy-context.bak');
  const hudPath = path.join(__dirname, 'bootstrap', 'hud.js');
  const monitorScript = path.resolve(__dirname, '..', 'src', 'main.js');
  const nodePath = findNode();
  if (!fs.existsSync(hudPath)) throw new Error('missing hud.js');
  if (!fs.existsSync(monitorScript)) throw new Error('missing src/main.js');
  if (!nodePath) throw new Error('node.exe not found');

  console.log('Antigravity', path.dirname(resources));
  console.log('Closing Antigravity to unlock app.asar...');
  closeAntigravity();

  if (!fs.existsSync(ownBak)) {
    fs.copyFileSync(asarPath, ownBak);
    console.log('backup', ownBak);
  }

  const tempDir = path.join(os.tmpdir(), 'agy-context-asar');
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

  extractPack(asarPath, tempDir, true);
  console.log('injected HUD into dist/preload.js');
  console.log('injected bootstrap into dist/main.js');
  console.log('monitor', nodePath, monitorScript, '--watch');
}

function uninstall() {
  const resources = resourcesDir();
  const asarPath = path.join(resources, 'app.asar');
  console.log('Closing Antigravity to unlock app.asar...');
  closeAntigravity();
  const tempDir = path.join(os.tmpdir(), 'agy-context-asar');
  extractPack(asarPath, tempDir, false);
  const preloadPath = path.join(tempDir, 'dist', 'preload.js');
  const mainPath = path.join(tempDir, 'dist', 'main.js');
  fs.writeFileSync(preloadPath, stripBlock(fs.readFileSync(preloadPath, 'utf8'), HUD_START, HUD_END), 'utf8');
  fs.writeFileSync(mainPath, stripBlock(fs.readFileSync(mainPath, 'utf8'), BOOT_START, BOOT_END), 'utf8');
  extractPack(asarPath, tempDir, true);
  console.log('removed HUD and bootstrap; localization left intact');
}

function main() {
  if (argFlag('--check')) {
    process.exit(check() ? 0 : 2);
  }
  if (argFlag('--uninstall')) {
    uninstall();
    return;
  }
  install();
}

main();
