import OpenAI from "openai";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { recordUsage } from "./cost.js";

let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL,
    });
  }
  return _client;
}

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

// ─── Logger ─────────────────────────────────────────────────────────────────

const LOG_ENABLED = process.env.POOHCODE_LOG !== "false"; // default: enabled
const LOG_DIR = resolve(process.env.POOHCODE_LOG_DIR || process.cwd(), "logs");

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getLogFile() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return resolve(LOG_DIR, `llm-${date}.log`);
}

function log(level, data) {
  if (!LOG_ENABLED) return;
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${JSON.stringify(data, null, 2)}\n`;
  try {
    appendFileSync(getLogFile(), line, "utf-8");
  } catch {
    // silently ignore write errors
  }
}

// ─── Helper: sanitize messages for logging ──────────────────────────────────

function sanitizeMessages(messages) {
  return messages.map((msg) => {
    const copy = { ...msg };
    // Truncate long content for readability
    if (copy.content && copy.content.length > 500) {
      copy.content = copy.content.slice(0, 500) + `\n... [truncated, total ${copy.content.length} chars]`;
    }
    // Summarize tool_calls
    if (copy.tool_calls) {
      copy.tool_calls = copy.tool_calls.map((tc) => ({
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments, // keep full args, they're usually short
        },
      }));
    }
    return copy;
  });
}

// ─── Retry ───────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function isRetryableError(err) {
  // Retry on rate limits, server errors, and network issues
  if (err.status === 429) return true;
  if (err.status >= 500 && err.status < 600) return true;
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNREFUSED") return true;
  if (err.type === "request_timeout" || err.type === "api_error") return true;
  return false;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function withRetry(fn, label = "API call") {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        log("RETRY", { label, attempt, delay: `${delay}ms`, error: err.message });
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── Main API ───────────────────────────────────────────────────────────────

function buildParams(messages, tools) {
  const params = {
    model: MODEL,
    messages,
  };
  if (tools && tools.length > 0) {
    params.tools = tools;
  }
  return params;
}

/**
 * Send messages to DeepSeek and get a response (non-streaming).
 * If the model returns tool_calls, they are included in the returned message.
 */
export async function chat(messages, { tools } = {}) {
  const params = buildParams(messages, tools);

  log("REQUEST", {
    model: MODEL,
    messageCount: messages.length,
    hasTools: !!(tools && tools.length > 0),
    messages: sanitizeMessages(messages),
  });

  const startTime = Date.now();
  const response = await withRetry(() => getClient().chat.completions.create(params), "chat");
  const elapsed = Date.now() - startTime;

  const result = response.choices[0].message;

  recordUsage(response.model, response.usage);

  log("RESPONSE", {
    elapsed: `${elapsed}ms`,
    model: response.model,
    usage: response.usage,
    ...summarizeMessage(result),
  });

  return result;
}

/**
 * Streaming chat: returns an async generator.
 *
 * Each yielded chunk has shape:
 *   { type: "content", text: string }        — text delta to display immediately
 *   { type: "done", message: object }        — final assembled message (may have tool_calls)
 *
 * Usage:
 *   for await (const chunk of chatStream(messages, { tools })) {
 *     if (chunk.type === "content") process.stdout.write(chunk.text);
 *     if (chunk.type === "done") handleFinal(chunk.message);
 *   }
 */
export async function* chatStream(messages, { tools } = {}) {
  const params = { ...buildParams(messages, tools), stream: true };

  log("REQUEST", {
    model: MODEL,
    messageCount: messages.length,
    hasTools: !!(tools && tools.length > 0),
    stream: true,
    messages: sanitizeMessages(messages),
  });

  const startTime = Date.now();
  const stream = await withRetry(() => getClient().chat.completions.create(params), "chatStream");

  // Accumulate deltas to assemble the final message
  const toolCalls = []; // sparse array, index-based
  let fullContent = "";
  let streamUsage = null;

  for await (const chunk of stream) {
    if (chunk.usage) streamUsage = chunk.usage;

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;

    // Reasoning / thinking content (DeepSeek-R1 etc.)
    // This appears before the main content and represents the model's
    // internal chain-of-thought.
    if (delta.reasoning_content) {
      yield { type: "reasoning", text: delta.reasoning_content };
    }

    // Text content deltas
    if (delta.content) {
      fullContent += delta.content;
      yield { type: "content", text: delta.content };
    }

    // Tool call deltas (arrive in chunks, accumulate by index)
    if (delta.tool_calls) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index;
        if (!toolCalls[idx]) {
          toolCalls[idx] = {
            id: tcDelta.id || "",
            type: "function",
            function: { name: "", arguments: "" },
          };
        }
        if (tcDelta.id) toolCalls[idx].id = tcDelta.id;
        if (tcDelta.function?.name) {
          toolCalls[idx].function.name += tcDelta.function.name;
        }
        if (tcDelta.function?.arguments) {
          toolCalls[idx].function.arguments += tcDelta.function.arguments;
        }
      }
    }
  }

  const elapsed = Date.now() - startTime;

  // Assemble final message
  const message = {
    role: "assistant",
    content: null,
  };
  const resolvedToolCalls = toolCalls.filter(Boolean);

  if (resolvedToolCalls.length > 0) {
    message.tool_calls = resolvedToolCalls;
    message.content = null;
  } else {
    message.content = fullContent;
  }

  recordUsage(MODEL, streamUsage);

  log("RESPONSE", {
    elapsed: `${elapsed}ms`,
    usage: streamUsage,
    ...summarizeMessage(message),
  });

  yield { type: "done", message };
}

// Shared response summary for logging
function summarizeMessage(msg) {
  const data = {};
  if (msg.content) {
    data.content =
      msg.content.length > 500
        ? msg.content.slice(0, 500) + `\n... [truncated, total ${msg.content.length} chars]`
        : msg.content;
  }
  if (msg.tool_calls) {
    data.tool_calls = msg.tool_calls.map((tc) => ({
      id: tc.id,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));
  }
  return data;
}
