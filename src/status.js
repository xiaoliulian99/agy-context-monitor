const fs = require('fs');
const path = require('path');
const os = require('os');

function statusDir() {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(root, 'agy-context-monitor');
}

function statusPath() {
  return path.join(statusDir(), 'status.json');
}

function activeCascadePath() {
  return path.join(statusDir(), 'active-cascade.json');
}

function isCascadeId(value) {
  return typeof value === 'string'
    && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value.trim());
}

function writeActiveCascadeHint(cascadeId, source) {
  const id = String(cascadeId || '').trim();
  if (!isCascadeId(id)) return null;
  const dir = statusDir();
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify({
    cascadeId: id,
    updatedAt: new Date().toISOString(),
    source: source || 'hud',
  });
  const dest = activeCascadePath();
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, dest);
  return dest;
}

function readActiveCascadeHint(maxAgeMs = 120000) {
  try {
    const raw = fs.readFileSync(activeCascadePath(), 'utf8');
    const data = JSON.parse(raw);
    const id = data && data.cascadeId;
    if (!isCascadeId(id)) return '';
    const t = Date.parse(data.updatedAt);
    if (isNaN(t) || (Date.now() - t) > maxAgeMs) return '';
    return String(id).trim();
  } catch {
    return '';
  }
}

function watchActiveCascade(onChange) {
  const dir = statusDir();
  fs.mkdirSync(dir, { recursive: true });
  let last = readActiveCascadeHint();
  const emit = () => {
    const id = readActiveCascadeHint();
    if (id === last) return;
    const prev = last;
    last = id;
    onChange(id, prev);
  };
  try {
    const watcher = fs.watch(dir, { persistent: true }, (_event, filename) => {
      const name = filename ? String(filename) : '';
      if (name && !name.startsWith('active-cascade.json')) return;
      emit();
    });
    return () => {
      try { watcher.close(); } catch { /* ignore */ }
    };
  } catch {
    const timer = setInterval(emit, 250);
    return () => clearInterval(timer);
  }
}

function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}

function toHudStatus(snap) {
  const u = snap.usage || {};
  const s = snap.session || {};
  const limit = Number(u.contextLimit) || 0;
  const used = Number(u.contextUsed) || 0;
  const percent = limit > 0 ? u.usagePercent : 0;
  return {
    updatedAt: new Date().toISOString(),
    state: snap.state || 'waiting-ag',
    usagePercent: Number(percent) || 0,
    contextUsed: used,
    contextLimit: limit,
    contextLabel: `${formatTokens(used)} / ${limit ? formatTokens(limit) : '?'}`,
    remainingLabel: limit > 0 ? formatTokens(Math.max(limit - used, 0)) : '-',
    model: u.modelDisplayName || u.model || '-',
    sessionId: s.cascadeId || '',
    sessionTitle: s.summary || '',
    sessionStatus: s.status || '',
    source: u.source || 'NONE',
    compressionDetected: !!u.compressionDetected,
    rewindDetected: !!u.rewindDetected,
  };
}

function writeStatus(snap) {
  const dir = statusDir();
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(toHudStatus(snap), null, 2);
  const tmp = statusPath() + '.tmp';
  fs.writeFileSync(tmp, payload, 'utf8');
  fs.renameSync(tmp, statusPath());
  return statusPath();
}

module.exports = {
  statusDir,
  statusPath,
  activeCascadePath,
  isCascadeId,
  writeActiveCascadeHint,
  readActiveCascadeHint,
  watchActiveCascade,
  toHudStatus,
  writeStatus,
  formatTokens,
};
