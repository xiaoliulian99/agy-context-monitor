#!/usr/bin/env node
const { Monitor, fingerprint, nextBackoff, BASE_INTERVAL_MS } = require('./monitor');
const { writeStatus, watchActiveCascade } = require('./status');

function argFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function describeAntigravity(snap) {
  if (snap.state === 'no-install') return 'Antigravity: not detected';
  if (snap.state === 'waiting-ag') return `Antigravity installed but not running (${snap.installDir})`;
  return `Antigravity detected (${snap.installDir || 'running'})`;
}

function describeLs(snap) {
  if (!snap.ls) {
    if (snap.state === 'waiting-ag') return 'Language Server: waiting for Antigravity';
    if (snap.state === 'waiting-ls') return 'Language Server: not detected';
    return 'Language Server: not detected';
  }
  const scheme = snap.ls.useTls ? 'https' : 'http';
  return `Language Server detected (pid ${snap.ls.pid}, ${scheme}://127.0.0.1:${snap.ls.port})`;
}

function describeSession(snap) {
  const s = snap.session;
  if (!s) return snap.state === 'no-session' ? '(none)' : '-';
  return `${s.cascadeId} (${s.status}, steps=${s.stepCount}, ${s.summary})`;
}

function describeModel(snap) {
  const u = snap.usage;
  if (!u || !u.model) return '-';
  return `${u.modelDisplayName} (${u.model})`;
}

function printSnapshot(snap) {
  const u = snap.usage;
  const limit = u && u.contextLimit;
  const percent = limit > 0 ? `${u.usagePercent.toFixed(1)}%` : (snap.state === 'live' ? 'n/a' : '-');
  const lines = [
    describeAntigravity(snap),
    describeLs(snap),
    `Session: ${describeSession(snap)}`,
    `Model: ${describeModel(snap)}`,
    `Checkpoint input: ${u.checkpointInput}`,
    `Checkpoint cache: ${u.checkpointCacheRead}`,
    `Checkpoint prompt: ${u.checkpointPrompt}`,
    `Checkpoint output: ${u.checkpointOutput}`,
    `Estimated delta: ${u.estimatedDelta}`,
    `Context: ${formatTokens(u.contextUsed)} / ${limit ? formatTokens(limit) : '?'}`,
    `Usage: ${percent}`,
    `Source: ${u.source}`,
    `Compression: ${u.compressionDetected ? `yes (drop ${u.compressionDrop})` : 'no'}`,
    `Rewind: ${u.rewindDetected ? `yes (steps ${u.previousStepCount} -> ${snap.session ? snap.session.stepCount : '?'})` : 'no'}`,
  ];
  if (snap.reason) lines.push(`Note: ${snap.reason}`);
  console.log(lines.join('\n'));
}

async function main() {
  const watch = argFlag('--watch');
  const monitor = new Monitor();
  let lastFp = '';
  let lastState = '';
  let failCount = 0;
  let failKind = 'discovery';
  let interval = BASE_INTERVAL_MS;
  let kick = null;
  let busy = false;
  let again = false;

  function wait(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (kick === wake) kick = null;
        resolve('tick');
      }, ms);
      const wake = () => {
        clearTimeout(timer);
        if (kick === wake) kick = null;
        resolve('hint');
      };
      kick = wake;
    });
  }

  const runOnce = async () => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        try {
          const snap = await monitor.collect();
          try { writeStatus(snap); } catch (_) { /* HUD file is best-effort */ }
          const fp = fingerprint(snap);
          const changed = fp !== lastFp;
          if (!watch || changed || !lastFp) {
            if (watch && lastFp) console.log('---');
            printSnapshot(snap);
            lastFp = fp;
            lastState = snap.state;
          }
          if (snap.state === 'live' || snap.state === 'no-session') {
            failCount = 0;
            interval = BASE_INTERVAL_MS;
          } else {
            failKind = snap.state === 'waiting-ls' || snap.state === 'waiting-ag' || snap.state === 'no-install'
              ? 'discovery'
              : 'rpc';
            failCount += 1;
            interval = nextBackoff(failKind, failCount);
            if (watch && changed && lastState !== 'live') {
              console.log(`Retry in ${interval / 1000}s`);
            }
          }
        } catch (err) {
          failKind = 'rpc';
          failCount += 1;
          interval = nextBackoff('rpc', failCount);
          monitor.invalidateLs();
          lastFp = `error:${err.message}`;
          console.log(`Error: ${err.message}`);
          if (watch) console.log(`Retry in ${interval / 1000}s`);
        }
      } while (again);
    } finally {
      busy = false;
    }
  };

  if (watch) {
    watchActiveCascade((id, prev) => {
      if (id && id !== prev) {
        again = true;
        if (kick) kick();
        else runOnce();
      }
    });
  }

  await runOnce();
  if (!watch) return;

  for (;;) {
    await wait(interval);
    await runOnce();
  }
}

main().catch((err) => {
  console.error(err);
});
