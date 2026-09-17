const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
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

async function listLanguageServerProcesses() {
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

async function findListeningPorts(pid) {
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
  const candidates = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir) return;
    const resolved = path.resolve(dir);
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(resolved);
  };
  add(process.env.ANTIGRAVITY_INSTALL_DIR);
  add(process.env.ANTIGRAVITY_HOME);
  const local = process.env.LOCALAPPDATA;
  if (local) add(path.join(local, 'Programs', 'antigravity'));
  add('C:\\Program Files\\Antigravity');
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'Antigravity.exe'))
      && fs.existsSync(path.join(dir, 'resources', 'app.asar'))) {
      return dir;
    }
  }
  return null;
}

async function isAntigravityRunning() {
  try {
    const psExe = winExe('powershell');
    const result = await execFileAsync(psExe, [
      '-NoProfile', '-NoLogo', '-Command',
      "Get-Process -Name Antigravity -ErrorAction SilentlyContinue | Select-Object -First 1 Id",
    ], { encoding: 'utf-8', timeout: 5000, windowsHide: true });
    return String(result.stdout || '').trim().length > 0;
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
  isAntigravityRunning,
  discoverLanguageServer,
  extractCsrfToken,
  extractWindowsPid,
  isLsCommandLine,
  parseAppConfig,
};
