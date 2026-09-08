const USER_INPUT = 'CORTEX_STEP_TYPE_USER_INPUT';
const PLANNER_RESPONSE = 'CORTEX_STEP_TYPE_PLANNER_RESPONSE';
const USER_INPUT_OVERHEAD = 500;
const PLANNER_RESPONSE_ESTIMATE = 800;
const SYSTEM_PROMPT_OVERHEAD = 10000;

function estimateTokensFromText(text) {
  if (!text) return 0;
  let asciiChars = 0;
  let nonAsciiChars = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) asciiChars++;
    else nonAsciiChars++;
  }
  return Math.ceil(asciiChars / 4 + nonAsciiChars / 1.5);
}

function estimateUserInput(step) {
  const ui = step.userInput;
  if (!ui) return USER_INPUT_OVERHEAD;
  return estimateTokensFromText(ui.userResponse || '');
}

function estimatePlannerResponse(step) {
  const pr = step.plannerResponse;
  if (!pr) return PLANNER_RESPONSE_ESTIMATE;
  let toolCallsText = '';
  for (const tc of pr.toolCalls || []) {
    toolCallsText += tc.argumentsJson || '';
  }
  return estimateTokensFromText((pr.response || '') + (pr.thinking || '') + toolCallsText);
}

function estimateStep(step) {
  const type = step.type || '';
  if (type === USER_INPUT) return estimateUserInput(step);
  if (type === PLANNER_RESPONSE) return estimatePlannerResponse(step);
  return 0;
}

module.exports = {
  USER_INPUT,
  PLANNER_RESPONSE,
  USER_INPUT_OVERHEAD,
  PLANNER_RESPONSE_ESTIMATE,
  SYSTEM_PROMPT_OVERHEAD,
  estimateTokensFromText,
  estimateStep,
};
