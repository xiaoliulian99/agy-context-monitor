const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
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
  return low.includes('language_server') && low.includes('antigravity');
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
    if (pid && csrfToken) {
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
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(path.join(local, 'Programs', 'antigravity'));
  candidates.push('C:\\Program Files\\Antigravity');
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
  const target = processes[0];
  const ports = await findListeningPorts(target.pid);
  for (const port of ports) {
    if (await probePort(port, target.csrfToken, true)) {
      return { pid: target.pid, csrfToken: target.csrfToken, port, useTls: true };
    }
    if (await probePort(port, target.csrfToken, false)) {
      return { pid: target.pid, csrfToken: target.csrfToken, port, useTls: false };
    }
  }
  return null;
}

module.exports = {
  findAntigravityInstallDir,
  isAntigravityRunning,
  discoverLanguageServer,
  extractCsrfToken,
  isLsCommandLine,
};
