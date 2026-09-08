const { rpcCall, metaBody } = require('./rpc');

const RUNNING = 'CASCADE_RUN_STATUS_RUNNING';

function parseTrajectories(resp) {
  const summaries = resp.trajectorySummaries || {};
  const result = [];
  for (const [cascadeId, data] of Object.entries(summaries)) {
    let requestedModel = '';
    let generatorModel = '';
    for (const latest of [data.latestTaskBoundaryStep, data.latestNotifyUserStep]) {
      const step = latest && latest.step;
      const meta = step && step.metadata;
      if (meta) {
        if (meta.generatorModel) generatorModel = meta.generatorModel;
        if (meta.requestedModel && meta.requestedModel.model) {
          requestedModel = meta.requestedModel.model;
        }
      }
    }
    const workspaceUris = [];
    for (const ws of data.workspaces || []) {
      if (ws.workspaceFolderAbsoluteUri) workspaceUris.push(ws.workspaceFolderAbsoluteUri);
    }
    result.push({
      cascadeId,
      trajectoryId: data.trajectoryId || '',
      summary: data.summary || cascadeId,
      stepCount: data.stepCount || 0,
      status: data.status || 'unknown',
      lastModifiedTime: data.lastModifiedTime || '',
      createdTime: data.createdTime || '',
      requestedModel: requestedModel || generatorModel,
      generatorModel,
      workspaceUris,
    });
  }
  result.sort((a, b) => String(b.lastModifiedTime).localeCompare(String(a.lastModifiedTime)));
  return result;
}

function selectCurrentSession(trajectories, trackedCascadeId) {
  if (!trajectories.length) return null;
  const running = trajectories
    .filter((t) => t.status === RUNNING)
    .sort((a, b) => String(b.lastModifiedTime).localeCompare(String(a.lastModifiedTime)));
  if (running.length) {
    const stillRunning = running.find((t) => t.cascadeId === trackedCascadeId);
    return stillRunning || running[0];
  }
  const newest = [...trajectories].sort((a, b) =>
    String(b.lastModifiedTime).localeCompare(String(a.lastModifiedTime))
  )[0];
  const tracked = trajectories.find((t) => t.cascadeId === trackedCascadeId);
  if (tracked) {
    if (newest && newest.cascadeId !== tracked.cascadeId
      && newest.lastModifiedTime && tracked.lastModifiedTime
      && newest.lastModifiedTime > tracked.lastModifiedTime) {
      return newest;
    }
    return tracked;
  }
  return newest;
}

async function getAllTrajectories(ls) {
  const resp = await rpcCall(ls, 'GetAllCascadeTrajectories', metaBody(), 15000);
  return parseTrajectories(resp);
}

async function getTrajectorySteps(ls, cascadeId, stepCount) {
  const maxSteps = Math.max(Number(stepCount) || 0, 0);
  const resp = await rpcCall(ls, 'GetCascadeTrajectorySteps', {
    cascadeId,
    startIndex: 0,
    endIndex: maxSteps,
  }, 30000);
  const steps = Array.isArray(resp.steps) ? resp.steps : [];
  if (steps.length > 0 || maxSteps === 0) return steps;

  const all = [];
  const seen = new Set();
  for (let start = 0; start < maxSteps; start += 50) {
    const end = Math.min(start + 50, maxSteps);
    const batch = await rpcCall(ls, 'GetCascadeTrajectorySteps', {
      cascadeId,
      startIndex: start,
      endIndex: end,
    }, 30000);
    for (const step of batch.steps || []) {
      const key = JSON.stringify([step.type, step.metadata && step.metadata.createdAt, step.metadata && step.metadata.executionId]);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(step);
    }
  }
  return all;
}

module.exports = {
  RUNNING,
  parseTrajectories,
  selectCurrentSession,
  getAllTrajectories,
  getTrajectorySteps,
};
