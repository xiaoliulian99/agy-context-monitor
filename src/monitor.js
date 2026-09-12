const {
  findAntigravityInstallDir,
  isAntigravityRunning,
  discoverLanguageServer,
} = require('./antigravity/discovery');
const { rpcCall, metaBody } = require('./antigravity/rpc');
const { getAllTrajectories, getLastSelectedCascadeId, selectCurrentSession, getTrajectorySteps } = require('./antigravity/session');
const { computeContext, limitsFromAvailableModels, labelsFromUserStatus, COMPRESSION_MIN_DROP } = require('./context/calculator');

const BASE_INTERVAL_MS = 5000;
const MAX_DISCOVERY_BACKOFF_MS = 15000;
const MAX_RPC_BACKOFF_MS = 60000;
const LS_REVALIDATE_POLLS = 6;

function emptyUsage() {
  return {
    model: '',
    modelDisplayName: 'unknown',
    checkpointInput: 0,
    checkpointCacheRead: 0,
    checkpointPrompt: 0,
    checkpointOutput: 0,
    estimatedDelta: 0,
    contextUsed: 0,
    contextLimit: 0,
    usagePercent: 0,
    source: 'NONE',
    stepCount: 0,
    compressionDetected: false,
    compressionDrop: 0,
    rewindDetected: false,
    previousStepCount: 0,
  };
}

function snapshot(state, extra) {
  return {
    ok: state === 'live' || state === 'no-session',
    state,
    installDir: null,
    ls: null,
    session: null,
    usage: emptyUsage(),
    reason: '',
    ...extra,
  };
}

class Monitor {
  constructor() {
    this.ls = null;
    this.limits = {};
    this.displayNames = {};
    this.trackedCascadeId = null;
    this.pollsSinceLsCheck = 0;
    this.cachedStepsKey = '';
    this.cachedSteps = [];
    this.prevStepCount = null;
    this.prevContextUsed = null;
    this.prevCascadeId = null;
  }

  invalidateLs() {
    this.ls = null;
    this.limits = {};
    this.displayNames = {};
    this.cachedStepsKey = '';
    this.cachedSteps = [];
  }

  resetSessionMemory() {
    this.prevStepCount = null;
    this.prevContextUsed = null;
    this.prevCascadeId = null;
    this.cachedStepsKey = '';
    this.cachedSteps = [];
  }

  async ensureLs(force) {
    if (!force && this.ls) return this.ls;
    const ls = await discoverLanguageServer();
    if (!ls) {
      this.invalidateLs();
      return null;
    }
    if (!this.ls || this.ls.pid !== ls.pid || this.ls.port !== ls.port || this.ls.csrfToken !== ls.csrfToken) {
      this.limits = {};
      this.displayNames = {};
      this.resetSessionMemory();
    }
    this.ls = ls;
    return ls;
  }

  async refreshModelMeta() {
    if (!this.ls) return;
    if (Object.keys(this.limits).length && Object.keys(this.displayNames).length) return;
    const [available, userStatus] = await Promise.all([
      rpcCall(this.ls, 'GetAvailableModels', metaBody(), 15000).catch(() => null),
      rpcCall(this.ls, 'GetUserStatus', metaBody(), 15000).catch(() => null),
    ]);
    if (available) this.limits = limitsFromAvailableModels(available).limits;
    if (userStatus) this.displayNames = labelsFromUserStatus(userStatus);
  }

  async stepsFor(session) {
    const key = `${session.cascadeId}|${session.stepCount}|${session.lastModifiedTime}`;
    if (key === this.cachedStepsKey && this.cachedSteps.length) return this.cachedSteps;
    const steps = await getTrajectorySteps(this.ls, session.cascadeId, session.stepCount);
    this.cachedStepsKey = key;
    this.cachedSteps = steps;
    return steps;
  }

  applyEventFlags(session, usage, switched) {
    const rewindDetected = !switched
      && this.prevCascadeId === session.cascadeId
      && this.prevStepCount != null
      && session.stepCount < this.prevStepCount;
    usage.rewindDetected = rewindDetected;
    usage.previousStepCount = this.prevStepCount || 0;

    if (rewindDetected) {
      usage.compressionDetected = false;
      usage.compressionDrop = 0;
      this.cachedStepsKey = '';
    } else if (
      !usage.compressionDetected
      && !switched
      && this.prevCascadeId === session.cascadeId
      && this.prevStepCount != null
      && session.stepCount >= this.prevStepCount
      && this.prevContextUsed != null
    ) {
      const drop = this.prevContextUsed - usage.contextUsed;
      if (drop > COMPRESSION_MIN_DROP) {
        usage.compressionDetected = true;
        usage.compressionDrop = drop;
      }
    }

    this.prevCascadeId = session.cascadeId;
    this.prevStepCount = session.stepCount;
    this.prevContextUsed = usage.contextUsed;
    return usage;
  }

  async collect() {
    const installDir = findAntigravityInstallDir();
    const running = await isAntigravityRunning();
    if (!installDir && !running) {
      this.invalidateLs();
      this.trackedCascadeId = null;
      this.resetSessionMemory();
      return snapshot('no-install', { reason: 'Antigravity not installed' });
    }
    if (!running) {
      this.invalidateLs();
      this.trackedCascadeId = null;
      this.resetSessionMemory();
      return snapshot('waiting-ag', { installDir, reason: 'waiting for Antigravity' });
    }

    this.pollsSinceLsCheck += 1;
    const forceRediscover = !this.ls || this.pollsSinceLsCheck >= LS_REVALIDATE_POLLS;
    if (forceRediscover) this.pollsSinceLsCheck = 0;

    let ls;
    try {
      ls = await this.ensureLs(forceRediscover);
    } catch (err) {
      this.invalidateLs();
      throw err;
    }
    if (!ls) {
      return snapshot('waiting-ls', { installDir, reason: 'waiting for Language Server' });
    }

    let trajectories;
    let selectedCascadeId = '';
    try {
      [trajectories, selectedCascadeId] = await Promise.all([
        getAllTrajectories(ls),
        getLastSelectedCascadeId(ls),
      ]);
      await this.refreshModelMeta();
    } catch (err) {
      this.invalidateLs();
      throw err;
    }

    const session = selectCurrentSession(trajectories, this.trackedCascadeId, selectedCascadeId);
    if (!session) {
      this.trackedCascadeId = null;
      this.resetSessionMemory();
      return snapshot('no-session', { installDir, ls, reason: 'no session' });
    }

    const switched = this.trackedCascadeId && this.trackedCascadeId !== session.cascadeId;
    if (switched) this.resetSessionMemory();
    this.trackedCascadeId = session.cascadeId;

    let steps;
    try {
      steps = await this.stepsFor(session);
    } catch (err) {
      this.invalidateLs();
      throw err;
    }

    let usage = computeContext(steps, {
      fallbackModel: session.requestedModel || session.generatorModel,
      limits: this.limits,
      displayNames: this.displayNames,
    });
    usage = this.applyEventFlags(session, usage, switched);

    let reason = '';
    if (switched) reason = 'session switched';
    else if (usage.rewindDetected) reason = `rewind detected (steps ${usage.previousStepCount} -> ${session.stepCount})`;
    else if (usage.compressionDetected) reason = `compression detected (drop ${usage.compressionDrop})`;

    return snapshot('live', {
      installDir,
      ls,
      session,
      usage,
      reason,
    });
  }
}

function fingerprint(snap) {
  if (snap.state !== 'live') return snap.state;
  const s = snap.session || {};
  const u = snap.usage || {};
  return [
    snap.ls && snap.ls.pid,
    snap.ls && snap.ls.port,
    s.cascadeId,
    s.status,
    s.stepCount,
    s.lastModifiedTime,
    u.contextUsed,
    u.source,
    u.model,
    u.compressionDetected,
    u.rewindDetected,
  ].join('|');
}

function nextBackoff(kind, failCount) {
  const cap = kind === 'rpc' ? MAX_RPC_BACKOFF_MS : MAX_DISCOVERY_BACKOFF_MS;
  const exp = Math.max(failCount - 1, 0);
  return Math.min(cap, BASE_INTERVAL_MS * (2 ** exp));
}

module.exports = {
  BASE_INTERVAL_MS,
  MAX_DISCOVERY_BACKOFF_MS,
  MAX_RPC_BACKOFF_MS,
  Monitor,
  fingerprint,
  nextBackoff,
};
