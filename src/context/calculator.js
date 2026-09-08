const { estimateStep, SYSTEM_PROMPT_OVERHEAD } = require('./estimator');

const CHECKPOINT = 'CORTEX_STEP_TYPE_CHECKPOINT';
const COMPRESSION_MIN_DROP = 5000;

function num(value) {
  const n = parseInt(String(value || '0'), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseModelUsage(mu) {
  if (!mu || typeof mu !== 'object') return null;
  const inputTokens = num(mu.inputTokens);
  const outputTokens = num(mu.outputTokens);
  const cacheReadTokens = num(mu.cacheReadTokens);
  const responseOutputTokens = num(mu.responseOutputTokens);
  const thinkingOutputTokens = num(mu.thinkingOutputTokens);
  if (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0) return null;
  return {
    model: mu.model || '',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    responseOutputTokens,
    thinkingOutputTokens,
    promptTokens: inputTokens + cacheReadTokens,
  };
}

function extractCheckpointUsage(step) {
  const meta = step.metadata || {};
  const direct = parseModelUsage(meta.modelUsage);
  if (direct) return { usage: direct, origin: 'CHECKPOINT.modelUsage' };
  const retries = Array.isArray(meta.retryInfos) ? meta.retryInfos : [];
  for (const retry of retries) {
    const usage = parseModelUsage(retry.usage);
    if (usage) return { usage, origin: 'CHECKPOINT.retryInfos.usage' };
  }
  return null;
}

function extractAnyUsage(step) {
  const meta = step.metadata || {};
  return parseModelUsage(meta.modelUsage);
}

function pickModel(steps, fallback) {
  let model = fallback || '';
  for (const step of steps) {
    const meta = step.metadata || {};
    if (meta.generatorModel && step.type !== CHECKPOINT) model = meta.generatorModel;
    if (meta.requestedModel && meta.requestedModel.model) model = meta.requestedModel.model;
  }
  return model;
}

function parseCheckpointerLimit(checkpointer) {
  if (!checkpointer) return 0;
  const raw = checkpointer.max_token_limit || checkpointer.max_limit;
  const n = num(raw);
  return n > 0 ? n : 0;
}

function limitsFromAvailableModels(resp) {
  const modelMap = (resp && resp.response && resp.response.models) || (resp && resp.models) || {};
  const limits = {};
  const labels = {};
  for (const [key, cfg] of Object.entries(modelMap)) {
    const model = cfg.model || '';
    const modelId = cfg.modelId || cfg.model_id || key;
    const exps = cfg.modelExperiments && cfg.modelExperiments.experiments;
    const raw = exps && exps.CASCADE_USE_EXPERIMENT_CHECKPOINTER && exps.CASCADE_USE_EXPERIMENT_CHECKPOINTER.stringValue;
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
    }
    const limit = parseCheckpointerLimit(parsed);
    if (limit > 0) {
      if (model) limits[model] = limit;
      if (modelId) limits[modelId] = limit;
    }
    if (model) labels[model] = modelId;
  }
  return { limits, labels };
}

function labelsFromUserStatus(resp) {
  const configs = ((((resp || {}).userStatus || {}).cascadeModelConfigData || {}).clientModelConfigs) || [];
  const labels = {};
  for (const c of configs) {
    const model = (c.modelOrAlias && c.modelOrAlias.model) || '';
    if (model && c.label) labels[model] = c.label;
  }
  return labels;
}

function detectCompression(steps, minDrop = COMPRESSION_MIN_DROP) {
  let prevPrompt = -1;
  let compressionDetected = false;
  let compressionDrop = 0;
  for (const step of steps) {
    let usage = null;
    if (step.type === CHECKPOINT) {
      const extracted = extractCheckpointUsage(step);
      if (extracted && extracted.origin === 'CHECKPOINT.modelUsage') usage = extracted.usage;
    } else {
      usage = extractAnyUsage(step);
    }
    if (!usage) continue;
    const prompt = usage.promptTokens;
    if (prevPrompt > 0 && prompt < prevPrompt) {
      const drop = prevPrompt - prompt;
      if (drop > minDrop && drop > compressionDrop) {
        compressionDetected = true;
        compressionDrop = drop;
      }
    }
    prevPrompt = prompt;
  }
  return { compressionDetected, compressionDrop };
}

function computeContext(steps, options = {}) {
  const fallbackModel = options.fallbackModel || '';
  const limits = options.limits || {};
  const displayNames = options.displayNames || {};

  let lastCheckpointIndex = -1;
  let lastCheckpointUsage = null;
  let lastCheckpointOrigin = '';
  let lastPreciseIndex = -1;
  let lastPreciseUsage = null;
  let lastPreciseOrigin = '';

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === CHECKPOINT) {
      lastCheckpointIndex = i;
      const extracted = extractCheckpointUsage(step);
      if (extracted && extracted.origin === 'CHECKPOINT.modelUsage') {
        lastCheckpointUsage = extracted.usage;
        lastCheckpointOrigin = extracted.origin;
      }
    }
    const usage = extractAnyUsage(step);
    if (usage) {
      lastPreciseIndex = i;
      lastPreciseUsage = usage;
      lastPreciseOrigin = `${step.type}.metadata.modelUsage`;
    }
  }

  const model = lastPreciseUsage && lastPreciseUsage.model
    ? lastPreciseUsage.model
    : pickModel(steps, fallbackModel);

  let baseline = null;
  let baselineIndex = -1;
  let source = '';

  if (lastCheckpointUsage) {
    baseline = lastCheckpointUsage;
    baselineIndex = lastCheckpointIndex;
    source = lastCheckpointOrigin;
  } else if (lastPreciseUsage) {
    baseline = lastPreciseUsage;
    baselineIndex = lastPreciseIndex;
    source = lastPreciseOrigin;
  }

  let estimatedDelta = 0;
  if (baseline) {
    for (let i = baselineIndex + 1; i < steps.length; i++) {
      estimatedDelta += estimateStep(steps[i]);
    }
  } else {
    estimatedDelta = SYSTEM_PROMPT_OVERHEAD;
    for (const step of steps) estimatedDelta += estimateStep(step);
    source = 'ESTIMATE';
  }

  const checkpointInput = baseline ? baseline.promptTokens : 0;
  const checkpointOutput = baseline ? baseline.outputTokens : 0;
  const rawInput = baseline ? baseline.inputTokens : 0;
  const cacheRead = baseline ? baseline.cacheReadTokens : 0;
  const contextUsed = checkpointInput + checkpointOutput + estimatedDelta;
  const contextLimit = limits[model] || 0;
  const usagePercent = contextLimit > 0 ? (contextUsed / contextLimit) * 100 : 0;

  if (baseline && estimatedDelta > 0) source = `${source} + ESTIMATE`;

  const compression = detectCompression(steps);

  return {
    model,
    modelDisplayName: displayNames[model] || model || 'unknown',
    checkpointInput: rawInput,
    checkpointCacheRead: cacheRead,
    checkpointPrompt: checkpointInput,
    checkpointOutput,
    estimatedDelta,
    contextUsed,
    contextLimit,
    usagePercent,
    source: source || 'NONE',
    isEstimated: !baseline || estimatedDelta > 0,
    stepCount: steps.length,
    compressionDetected: compression.compressionDetected,
    compressionDrop: compression.compressionDrop,
  };
}

module.exports = {
  CHECKPOINT,
  COMPRESSION_MIN_DROP,
  parseModelUsage,
  detectCompression,
  limitsFromAvailableModels,
  labelsFromUserStatus,
  computeContext,
};
