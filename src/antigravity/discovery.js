const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { rpcCall } = require('./rpc');

const execFileAsync = promisify(execFile);

function winRoot() {
  return process.env.SystemRoot || process.env.windir || 'C:\\Windows';
}

function winExe(kind) {
  const root = winRoot();
  const rel = {
    powershell: 'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    netstat: 'System32\\NETSTAT.EXE',
    wmic: 'System32\\wbem\\WMIC.exe',
    tasklist: 'System32\\tasklist.exe',
  };
  return path.join(root, rel[kind]);
}

function extractCsrfToken(commandLine) {
  const m = String(commandLine || '').match(/--csrf_token\s+([^\s]+)/);
  return m ? m[1] : null;
}

function extractWindowsPid(line) {
  const trimmed = String(line || '').replace(/\r+$/, '').trim();
  if (!trimmed) return null;
  const psMatch = trimmed.match(/^\s*"?(\d+)"?\s*,/);
  if (psMatch) {
    const n = parseInt(psMatch[1], 10);
    if (n > 0) return n;
  }
  const wmicMatch = trimmed.match(/,(\d+)\s*$/);
  if (wmicMatch) {
    const n = parseInt(wmicMatch[1], 10);
    if (n > 0) return n;
  }
  return null;
}

function isLsCommandLine(commandLine) {
  const low = String(commandLine || '').toLowerCase();
  if (low.includes('language_server.exe')) return true;
  return low.includes('language_server') && low.includes('antigravity');
}

function parseAppConfig(html) {
  const m = String(html || '').match(/window\.__APP_CONFIG__\s*=\s*(\{[^<]*\})/);
  if (!m) return null;
  try {
    const cfg = JSON.parse(m[1]);
    return cfg && typeof cfg === 'object' ? cfg : null;
  } catch {
    return null;
  }
}

function fetchText(port, useTls, pathname, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const transport = useTls ? https : http;
    const req = transport.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        if (chunks.reduce((n, c) => n + c.length, 0) > 1024 * 1024) {
          req.destroy();
          reject(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

async function readAppConfig(port, useTls) {
  try {
    return parseAppConfig(await fetchText(port, useTls, '/'));
  } catch {
    return null;
  }
}

function isLoopbackReachableHost(host) {
  const bare = String(host || '').replace(/%[^\]]*(?=\]?$)/, '');
  return bare === '127.0.0.1' || bare === '0.0.0.0' || bare === '*'
    || bare === '::' || bare === '[::]' || bare === '[::1]';
}

function extractPortFromNetstat(line) {
  const cols = String(line || '').trim().split(/\s+/);
  if (cols.length < 3) return null;
  const token = cols[1];
  const m = token && token.match(/^(.*):(\d+)$/);
  if (!m || !isLoopbackReachableHost(m[1])) return null;
  const port = parseInt(m[2], 10);
  return port > 0 && port <= 65535 ? port : null;
}

function netstatLineMatchesPid(line, pid) {
  const trimmed = String(line || '').trim();
  const m = trimmed.match(/\s(\d+)$/);
  if (!m || m[1] !== String(pid)) return false;
  if (trimmed.includes('LISTENING')) return true;
  const cols = trimmed.split(/\s+/);
  if (cols.length !== 5 || cols[0].toUpperCase() !== 'TCP') return false;
  return cols[2] === '0.0.0.0:0' || cols[2] === '[::]:0' || cols[2] === '*:*';
}

function isMacLsCommandLine(commandLine) {
  const low = String(commandLine || '').toLowerCase();
  return low.includes('language_server') && low.includes('antigravity');
}

function parseMacPsLines(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\S[\s\S]*)$/);
    if (!match) continue;
    const pid = parseInt(match[1], 10);
    const commandLine = match[2];
    if (!(pid > 0) || !isMacLsCommandLine(commandLine)) continue;
    out.push({ pid, csrfToken: extractCsrfToken(commandLine), commandLine });
  }
  return out;
}

function parseLsofListenPorts(text) {
  const ports = [];
  for (const line of String(text || '').split(/\n/)) {
    const match = line.match(/\bTCP\s+(\S+)\s+\(LISTEN\)/);
    if (!match) continue;
    const endpoint = match[1].match(/^(.*):(\d+)$/);
    if (!endpoint || !isLoopbackReachableHost(endpoint[1])) continue;
    const port = parseInt(endpoint[2], 10);
    if (port > 0 && port <= 65535 && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

function installCandidateDirs(platform, env, homedir) {
  const dirs = [];
  const add = (dir) => { if (dir) dirs.push(dir); };
  add(env && env.ANTIGRAVITY_INSTALL_DIR);
  add(env && env.ANTIGRAVITY_HOME);
  if (platform === 'darwin') {
    add('/Applications/Antigravity.app');
    add('/Applications/Antigravity IDE.app');
    add(path.join(homedir || '', 'Applications', 'Antigravity.app'));
    add(path.join(homedir || '', 'Applications', 'Antigravity IDE.app'));
    return dirs;
  }
  if (env && env.LOCALAPPDATA) add(path.join(env.LOCALAPPDATA, 'Programs', 'antigravity'));
  add('C:\\Program Files\\Antigravity');
  return dirs;
}

function inspectAntigravityPath(dir) {
  if (!dir) return null;
  let resolved;
  try { resolved = path.resolve(dir); } catch (_) { return null; }
  const macExe = path.join(resolved, 'Contents', 'MacOS', 'Antigravity');
  const macAsar = path.join(resolved, 'Contents', 'Resources', 'app.asar');
  if (fs.existsSync(macExe) && fs.existsSync(macAsar)) {
    return {
      installDir: resolved,
      resourcesDir: path.join(resolved, 'Contents', 'Resources'),
      executable: macExe,
      appBundle: resolved,
    };
  }
  const contentsExe = path.join(resolved, 'MacOS', 'Antigravity');
  const contentsAsar = path.join(resolved, 'Resources', 'app.asar');
  if (fs.existsSync(contentsExe) && fs.existsSync(contentsAsar)) {
    const appBundle = path.dirname(resolved);
    return {
      installDir: appBundle,
      resourcesDir: path.join(resolved, 'Resources'),
      executable: contentsExe,
      appBundle,
    };
  }
  const winExe = path.join(resolved, 'Antigravity.exe');
  const winAsar = path.join(resolved, 'resources', 'app.asar');
  if (fs.existsSync(winExe) && fs.existsSync(winAsar)) {
    return {
      installDir: resolved,
      resourcesDir: path.join(resolved, 'resources'),
      executable: winExe,
      appBundle: null,
    };
  }
  return null;
}

function findAntigravityLayout() {
  const seen = new Set();
  const dirs = installCandidateDirs(process.platform, process.env, os.homedir());
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    const layout = inspectAntigravityPath(resolved);
    if (layout) return layout;
  }
  return null;
}

async function listMacLanguageServerProcesses() {
  try {
    const result = await execFileAsync('/bin/ps', ['-ax', '-o', 'pid=,command='], {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return parseMacPsLines(result.stdout);
  } catch (_) {
    return [];
  }
}

async function listLanguageServerProcesses() {
  if (process.platform === 'darwin') return listMacLanguageServerProcesses();
  const psExe = winExe('powershell');
  const result = await execFileAsync(psExe, [
    '-NoProfile', '-NoLogo', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name like 'language_server%'\" | Select-Object ProcessId, Name, CommandLine | ConvertTo-Csv -NoTypeInformation",
  ], { encoding: 'utf-8', timeout: 10000, windowsHide: true });

    const lines = String(result.stdout || '').split(/\r?\n/).filter((l) => isLsCommandLine(l));
    const out = [];
    for (const line of lines) {
      const pid = extractWindowsPid(line);
      const csrfToken = extractCsrfToken(line);
      if (pid) {
        out.push({ pid, csrfToken, commandLine: line });
      }
    }
    return out;
}

async function findMacListeningPorts(pid) {
  try {
    const result = await execFileAsync('/usr/sbin/lsof', [
      '-nP', '-iTCP', '-sTCP:LISTEN', '-p', String(pid),
    ], { encoding: 'utf-8', timeout: 5000 });
    return parseLsofListenPorts(result.stdout);
  } catch (_) {
    return [];
  }
}

async function findListeningPorts(pid) {
  if (process.platform === 'darwin') return findMacListeningPorts(pid);
  const netstatExe = winExe('netstat');
  const result = await execFileAsync(netstatExe, ['-ano'], {
    encoding: 'utf-8',
    timeout: 5000,
    windowsHide: true,
  });
  const ports = [];
  for (const line of String(result.stdout || '').split(/\n/)) {
    if (!netstatLineMatchesPid(line, pid)) continue;
    const port = extractPortFromNetstat(line);
    if (port !== null && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

async function probePort(port, csrfToken, useTls) {
  try {
    await rpcCall({ port, csrfToken, useTls }, 'GetUnleashData', {
      metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
        ideVersion: 'unknown',
        locale: 'en',
      },
    }, 3000);
    return true;
  } catch {
    return false;
  }
}

function findAntigravityInstallDir() {
  const layout = findAntigravityLayout();
  return layout ? layout.installDir : null;
}

async function isAntigravityRunning() {
  if (process.platform === 'darwin') {
    try {
      await execFileAsync('/usr/bin/pgrep', ['-x', 'Antigravity'], {
        encoding: 'utf-8',
        timeout: 3000,
      });
      return true;
    } catch (_) {
      return false;
    }
  }
  try {
    const result = await execFileAsync(winExe('tasklist'), [
      '/fi', 'imagename eq Antigravity.exe', '/nh',
    ], { encoding: 'utf-8', timeout: 3000, windowsHide: true });
    return String(result.stdout || '').toLowerCase().includes('antigravity.exe');
  } catch {
    return false;
  }
}

async function discoverLanguageServer() {
  const processes = await listLanguageServerProcesses();
  if (processes.length === 0) return null;
  for (const target of processes) {
    const ports = await findListeningPorts(target.pid);
    for (const port of ports) {
      for (const useTls of [true, false]) {
        const cfg = await readAppConfig(port, useTls);
        if (cfg && cfg.productName && String(cfg.productName).toLowerCase() !== 'antigravity') continue;
        const csrfToken = (cfg && cfg.csrfToken) || target.csrfToken;
        if (!csrfToken) continue;
        if (await probePort(port, csrfToken, useTls)) {
          return {
            pid: target.pid,
            csrfToken,
            port,
            useTls,
            appVersion: cfg && cfg.appVersion,
          };
        }
      }
    }
  }
  return null;
}

module.exports = {
  findAntigravityInstallDir,
  findAntigravityLayout,
  inspectAntigravityPath,
  installCandidateDirs,
  isAntigravityRunning,
  discoverLanguageServer,
  extractCsrfToken,
  extractWindowsPid,
  isLsCommandLine,
  isMacLsCommandLine,
  parseMacPsLines,
  parseLsofListenPorts,
  parseAppConfig,
};
