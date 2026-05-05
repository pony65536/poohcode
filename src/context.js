import { chat } from "./llm.js";
import { get } from "./config.js";
import { encoding_for_model } from "tiktoken";

// ─── Configuration ───────────────────────────────────────────────────────────

const MAX_CONTEXT_TOKENS = get("context.maxTokens", 90000);
const KEEP_RECENT_ROUNDS = get("context.keepRecentRounds", 3);
const SOFT_LIMIT_RATIO = get("context.softLimitRatio", 0.70);
const HARD_LIMIT_RATIO = get("context.hardLimitRatio", 0.85);
const MAX_TOOL_RESULT_CHARS = get("context.maxToolResultChars", 4000);

// ─── Token counting (tiktoken cl100k_base, close to DeepSeek tokenizer) ──────

let _encoder = null;
function getEncoder() {
  if (!_encoder) _encoder = encoding_for_model("gpt-4");
  return _encoder;
}

/**
 * Exact token count for a string using tiktoken.
 */
export function countTokens(text) {
  if (!text) return 0;
  try {
    return getEncoder().encode(text).length;
  } catch {
    // Fallback: character-based estimation (~4 chars/token)
    return Math.ceil(text.length / 4);
  }
}

/**
 * Estimate total tokens for a messages array using tiktoken + overhead.
 */
export function estimateMessagesTokens(messages) {
  let total = 0;
  const enc = getEncoder();
  for (const msg of messages) {
    total += 4; // role + framing overhead per message
    if (typeof msg.content === "string") {
      total += enc.encode(msg.content).length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.text) total += enc.encode(part.text).length;
      }
    }
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        total += enc.encode(tc.function?.name || "").length;
        total += enc.encode(tc.function?.arguments || "").length;
      }
    }
    if (msg.tool_call_id) {
      total += enc.encode(msg.tool_call_id).length;
    }
  }
  return total;
}

// ─── Round Splitting ─────────────────────────────────────────────────────────

/**
 * Split messages into "rounds". Each round starts with a user message
 * and contains all assistant/tool messages that follow until the next user message.
 */
export function splitRounds(messages) {
  const rounds = [];
  let current = [];
  for (const msg of messages) {
    if (msg.role === "user" && current.length > 0) {
      rounds.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) rounds.push(current);
  return rounds;
}

// ─── Tool Result Truncation ──────────────────────────────────────────────────

/**
 * Truncate large tool results in old rounds (not the most recent ones).
 * Preserves the beginning of the result + adds a hint about how to read more.
 */
function truncateOldToolResults(rounds, keepRecent) {
  const oldRounds = rounds.slice(0, -keepRecent || rounds.length);
  for (const round of oldRounds) {
    for (const msg of round) {
      if (msg.role === "tool" && typeof msg.content === "string" && msg.content.length > MAX_TOOL_RESULT_CHARS) {
        const truncated = msg.content.slice(0, MAX_TOOL_RESULT_CHARS);
        msg.content = truncated +
          `\n\n[... result truncated at ${MAX_TOOL_RESULT_CHARS}/${msg.content.length} chars. ` +
          `To read specific portions, use the tool again with offset/limit parameters.]`;
      }
    }
  }
}

// ─── LLM Summarization ──────────────────────────────────────────────────────

const SUMMARY_SYSTEM = [
  "You are a conversation compressor. Produce a dense summary that preserves ALL information needed to continue coding work.",
  "",
  "You MUST include:",
  "1. The user's original goal and any sub-tasks",
  "2. What has been DONE: files created/modified (with paths), commands run, their results",
  "3. Key decisions and rationale",
  "4. Errors encountered and how they were resolved",
  "5. Current state: what works, what's broken, what's in progress",
  "6. What REMAINS to be done (pending requests)",
  "",
  "Be extremely specific — include exact file paths, function names, command outputs. This is a compressed transcript, not a high-level overview.",
  "Output ONLY the summary text, no preamble.",
].join("\n");

async function summarizeRounds(rounds) {
  const messages = [{ role: "system", content: SUMMARY_SYSTEM }];

  for (const round of rounds) {
    for (const msg of round) {
      const copy = { ...msg };
      // Truncate overly long content before sending to summarizer
      // Find a natural boundary (last newline before the limit)
      if (typeof copy.content === "string" && copy.content.length > 1500) {
        const slice = copy.content.slice(0, 1500);
        const lastNL = slice.lastIndexOf("\n");
        const cutPoint = lastNL > 750 ? lastNL : 1500; // at least 50% utilized
        copy.content = copy.content.slice(0, cutPoint) + "\n[...truncated]";
      }
      if (copy.tool_calls) {
        copy.tool_calls = copy.tool_calls.map(tc => ({
          ...tc,
          function: {
            name: tc.function.name,
            arguments: (tc.function.arguments || "").slice(0, 500),
          },
        }));
      }
      messages.push(copy);
    }
  }

  messages.push({
    role: "user",
    content: "Summarize the conversation above. Include all specific file paths, function names, and decisions.",
  });

  try {
    const response = await chat(messages, { tools: [] });
    return response.content || "[Summary generation returned empty.]";
  } catch (err) {
    return `[Summary generation failed: ${err.message}. Some context from earlier conversation may be lost.]`;
  }
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * Manage the conversation context to keep it within token limits.
 * Called before each LLM call in the agent loop.
 *
 * Strategy (in order of increasing aggression):
 * 1. Within limits → return unchanged
 * 2. Soft limit (70%) → truncate large tool results in old rounds
 * 3. Hard limit (85%) → compress old rounds into an LLM summary
 *
 * @param {Array} messages - The full message array (including system prompt).
 * @returns {Promise<Array>} - The managed message array.
 */
export async function manageContext(messages) {
  const totalTokens = estimateMessagesTokens(messages);

  // ── Step 1: Within limits, no action ──────────────────────────────────
  if (totalTokens < MAX_CONTEXT_TOKENS * SOFT_LIMIT_RATIO) {
    return messages;
  }

  // ── Extract system prompt ─────────────────────────────────────────────
  const systemIdx = messages.findIndex(m => m.role === "system");
  const systemMessages = systemIdx >= 0 ? messages.slice(0, systemIdx + 1) : [];
  const conversation = systemIdx >= 0 ? messages.slice(systemIdx + 1) : messages;
  const rounds = splitRounds(conversation);

  // ── Always preserve the last round (contains user's latest instruction) ─
  // The last round contains the most recent user message + LLM responses + tool results.
  // We NEVER compress or truncate the latest round to ensure the model
  // always has the user's most recent instruction in full context.
  const latestRound = rounds.length > 0 ? rounds.pop() : [];

  // ── Step 2: Soft limit — truncate old tool results ────────────────────
  if (totalTokens < MAX_CONTEXT_TOKENS * HARD_LIMIT_RATIO) {
    truncateOldToolResults(rounds, KEEP_RECENT_ROUNDS);
    return [...systemMessages, ...rounds.flat(), ...latestRound];
  }

  // ── Step 3: Hard limit — summarize old rounds ─────────────────────────
  if (rounds.length <= KEEP_RECENT_ROUNDS) {
    // Nothing to compress — just truncate everything aggressively
    truncateOldToolResults(rounds, 0);
    return [...systemMessages, ...rounds.flat(), ...latestRound];
  }

  const oldRounds = rounds.slice(0, -KEEP_RECENT_ROUNDS);
  const recentRounds = rounds.slice(-KEEP_RECENT_ROUNDS);

  const summary = await summarizeRounds(oldRounds);

  const result = [
    ...systemMessages,
    {
      role: "system",
      content: `[Earlier conversation context — compressed for token efficiency. Key information is preserved but details may be omitted. Use search_code and read_file to re-examine specific files if needed.]\n\n${summary}`,
    },
    ...recentRounds.flat(),
    ...latestRound,
  ];

  // Safety check: if summary somehow made things worse, fall back to truncation
  if (estimateMessagesTokens(result) > MAX_CONTEXT_TOKENS * 0.95) {
    truncateOldToolResults(recentRounds, 0);
    return [...systemMessages, ...recentRounds.flat(), ...latestRound];
  }

  return result;
}
