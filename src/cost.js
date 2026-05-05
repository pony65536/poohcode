// DeepSeek pricing per 1M tokens (as of 2025)
// deepseek-chat: $0.27 input, $1.10 output
const PRICING = {
  "deepseek-chat": { input: 0.27, output: 1.10 },
  "deepseek-v4-pro": { input: 0.27, output: 1.10 },
  "deepseek-v4-flash": { input: 0.14, output: 0.55 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

let sessionStats = {
  requests: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
};

/**
 * Record usage from a single API call.
 */
export function recordUsage(model, usage) {
  if (!usage) return;

  const prompt = usage.prompt_tokens || 0;
  const completion = usage.completion_tokens || 0;
  const total = usage.total_tokens || prompt + completion;

  sessionStats.requests++;
  sessionStats.promptTokens += prompt;
  sessionStats.completionTokens += completion;
  sessionStats.totalTokens += total;

  const pricing = PRICING[model] || PRICING["deepseek-chat"];
  const cost = (prompt / 1_000_000) * pricing.input + (completion / 1_000_000) * pricing.output;
  sessionStats.estimatedCost += cost;
}

/**
 * Get a summary of session usage.
 */
export function getSessionStats() {
  return {
    ...sessionStats,
    promptTokensFormatted: sessionStats.promptTokens.toLocaleString(),
    completionTokensFormatted: sessionStats.completionTokens.toLocaleString(),
    totalTokensFormatted: sessionStats.totalTokens.toLocaleString(),
    costFormatted: `$${sessionStats.estimatedCost.toFixed(4)}`,
  };
}

/**
 * Format a one-line summary for display after each turn.
 */
export function getTurnSummary() {
  return `${sessionStats.requests} req, ${sessionStats.totalTokens.toLocaleString()} tokens, ~$${sessionStats.estimatedCost.toFixed(4)}`;
}

/**
 * Reset session stats (e.g., on "clear").
 */
export function resetStats() {
  sessionStats = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };
}
