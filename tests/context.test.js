const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectCompression, computeContext, COMPRESSION_MIN_DROP } = require('../src/context/calculator');
const { Monitor } = require('../src/monitor');
const {
  RUNNING,
  pickSelectedCascadeId,
  selectCurrentSession,
  extractCascadeId,
  isCurrentCascadeRpc,
  stubSession,
} = require('../src/antigravity/session');
const { writeActiveCascadeHint, readActiveCascadeHint, watchActiveCascade } = require('../src/status');

function usage(input, cache) {
  return { inputTokens: String(input), outputTokens: '10', cacheReadTokens: String(cache) };
}

function planner(input, cache) {
  return {
    type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
    metadata: { modelUsage: usage(input, cache), generatorModel: 'MODEL_PLACEHOLDER_M318' },
    plannerResponse: { response: 'ok' },
  };
}

function checkpoint() {
  return { type: 'CORTEX_STEP_TYPE_CHECKPOINT', metadata: { retryInfos: [{ usage: usage(120, 0) }] } };
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const noDrop = detectCompression([planner(4000, 20000), planner(5000, 21000)]);
assert(!noDrop.compressionDetected, 'no false compression on growing prompt');

const compressed = detectCompression([planner(40000, 20000), planner(8000, 5000)]);
assert(compressed.compressionDetected, 'detect promptTokens drop');
assert(compressed.compressionDrop > COMPRESSION_MIN_DROP, 'drop exceeds threshold');

const tiny = detectCompression([planner(10000, 0), planner(8000, 0)]);
assert(!tiny.compressionDetected, 'ignore drop <= 5000');

const ignoreRetry = detectCompression([checkpoint(), planner(20000, 10000)]);
assert(!ignoreRetry.compressionDetected, 'ignore checkpoint retryInfos usage');

const result = computeContext([planner(40000, 20000), planner(8000, 5000)], {
  limits: { MODEL_PLACEHOLDER_M318: 256000 },
});
assert(result.compressionDetected, 'computeContext surfaces compression');
assert(result.contextUsed === 8000 + 5000 + 10, `context uses latest prompt+output, got ${result.contextUsed}`);

const mon = new Monitor();
const session = { cascadeId: 'x', stepCount: 40, lastModifiedTime: '2' };
const u1 = { contextUsed: 60000, compressionDetected: false, compressionDrop: 0 };
mon.applyEventFlags({ ...session, stepCount: 40 }, { ...u1 }, false);
const rewind = mon.applyEventFlags({ ...session, stepCount: 22 }, {
  contextUsed: 20000,
  compressionDetected: true,
  compressionDrop: 40000,
}, false);
assert(rewind.rewindDetected, 'stepCount drop is rewind');
assert(!rewind.compressionDetected, 'rewind is not compression');

const mon2 = new Monitor();
mon2.applyEventFlags({ ...session, stepCount: 40 }, { contextUsed: 60000, compressionDetected: false, compressionDrop: 0 }, false);
const cross = mon2.applyEventFlags({ ...session, stepCount: 41 }, {
  contextUsed: 20000,
  compressionDetected: false,
  compressionDrop: 0,
}, false);
assert(cross.compressionDetected, 'cross-poll compression when stepCount did not drop');
assert(cross.compressionDrop === 40000, `cross-poll drop 40000 got ${cross.compressionDrop}`);

assert(pickSelectedCascadeId({
  userSettings: { lastSelectedCascadeId: 'abc' },
}) === 'abc', 'pick lastSelectedCascadeId from userSettings');
assert(pickSelectedCascadeId({
  user_settings: { last_selected_cascade_id: ' def ' },
}) === 'def', 'pick last_selected_cascade_id and trim');
assert(pickSelectedCascadeId({}) === '', 'empty settings has no selected id');

function traj(id, extra) {
  return { cascadeId: id, lastModifiedTime: '2026-01-01T00:00:00Z', status: 'idle', ...extra };
}

const a = traj('a', { lastModifiedTime: '2026-01-01T00:00:00Z' });
const b = traj('b', { lastModifiedTime: '2026-01-02T00:00:00Z' });
const runningA = traj('a', { status: RUNNING, lastModifiedTime: '2026-01-03T00:00:00Z' });
const olderB = traj('b', { lastModifiedTime: '2025-12-01T00:00:00Z' });

assert(selectCurrentSession([a, olderB], 'a', 'b').cascadeId === 'b', 'selected idle session wins immediately');
assert(selectCurrentSession([runningA, olderB], 'a', 'b').cascadeId === 'b', 'selected session wins over running tracked');
assert(selectCurrentSession([a, b], 'a', 'c0ffeeee-0000-4000-8000-00000000000c').cascadeId === 'c0ffeeee-0000-4000-8000-00000000000c', 'hinted session not in list still wins');
assert(selectCurrentSession([a, olderB], 'a', '').cascadeId === 'a', 'tracked sticks when selected missing and newer is older');
assert(selectCurrentSession([runningA, b], 'a', '').cascadeId === 'a', 'running tracked kept without selected id');
assert(selectCurrentSession([a, b], null, '').cascadeId === 'b', 'newest used when nothing tracked');
assert(stubSession('c0ffeeee-0000-4000-8000-00000000000c').stepCount === 0, 'stub session has zero steps');

assert(extractCascadeId('{"cascadeId":"87a19af4-e8ff-4224-9812-f270360a73c4"}') === '87a19af4-e8ff-4224-9812-f270360a73c4', 'extract cascadeId from json');
assert(extractCascadeId('{"trajectoryId":"8336e6d5-52b8-4e5d-beaf-f26850cc9656"}') === '', 'ignore trajectoryId');
assert(isCurrentCascadeRpc('/exa.language_server_pb.LanguageServerService/GetCascadeTrajectorySteps') === true, 'steps rpc is current');
assert(isCurrentCascadeRpc('/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories') === false, 'list rpc is not current');

const prevLocal = process.env.LOCALAPPDATA;
const hintDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hint-'));
process.env.LOCALAPPDATA = hintDir;
writeActiveCascadeHint('87a19af4-e8ff-4224-9812-f270360a73c4', 'test');
assert(readActiveCascadeHint() === '87a19af4-e8ff-4224-9812-f270360a73c4', 'read fresh cascade hint');
const stalePath = path.join(hintDir, 'agy-context-monitor', 'active-cascade.json');
fs.writeFileSync(stalePath, JSON.stringify({
  cascadeId: '87a19af4-e8ff-4224-9812-f270360a73c4',
  updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  source: 'test',
}));
assert(readActiveCascadeHint(120000) === '', 'stale cascade hint ignored');

writeActiveCascadeHint('87a19af4-e8ff-4224-9812-f270360a73c4', 'test');
const seen = [];
const stopWatch = watchActiveCascade((id) => { seen.push(id); });
writeActiveCascadeHint('f8a760ca-d1cd-49ee-a7a5-c24a80a883da', 'test');

function finish(okWatch) {
  stopWatch();
  assert(okWatch, 'watch fires on cascade hint change');
  if (prevLocal === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = prevLocal;
  if (failed) process.exit(1);
  console.log('all tests passed');
}

let n = 0;
const timer = setInterval(() => {
  n += 1;
  if (seen[0] === 'f8a760ca-d1cd-49ee-a7a5-c24a80a883da') {
    clearInterval(timer);
    finish(true);
  } else if (n >= 30) {
    clearInterval(timer);
    finish(false);
  }
}, 50);
