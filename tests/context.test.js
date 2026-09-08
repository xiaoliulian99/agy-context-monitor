const { detectCompression, computeContext, COMPRESSION_MIN_DROP } = require('../src/context/calculator');
const { Monitor } = require('../src/monitor');

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

if (failed) {
  process.exit(1);
}
console.log('all tests passed');
