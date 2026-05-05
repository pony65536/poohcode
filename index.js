import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runAgent } from "./src/agent.js";
import { getTurnSummary, getSessionStats } from "./src/cost.js";
import { saveCheckpoint, listCheckpoints, restoreCheckpoint } from "./src/checkpoint.js";
import {
  chalk,
  style,
  formatBanner,
  formatSessionRestored,
  formatUsageHint,
  highlightStream,
  resetCodeBlockState,
  resetThinkingState,
  formatConfirmPrompt,
  formatDenied,
  showConfirmSelector,
  formatTurnSummary,
  formatSessionStats,
  formatShutdown,
  formatShutdownStats,
  formatError,
  formatContextTrim,
  formatExit,
  formatCleared,
  formatThinking,
  formatThinkingEnd,
  showLanguageSelector,
  formatAllowed,
  formatAllowedAll,
  getLang,
  setLang,
  createReadline,
  setMultiLinePrompt,
  setNormalPrompt,
  formatMultiLineHint,
  createPinnedWrite,
  redrawInput,
} from "./src/ui.js";

// ─── Session persistence ────────────────────────────────────────────────────

const SESSION_DIR = resolve(process.cwd(), ".poohcode");
const SESSION_FILE = resolve(SESSION_DIR, "session.json");

function saveSession(history) {
  try {
    if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, JSON.stringify(history, null, 2), "utf-8");
  } catch {
    // silently ignore save errors
  }
}

function loadSession() {
  try {
    if (existsSync(SESSION_FILE)) {
      const data = readFileSync(SESSION_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // corrupted file, ignore
  }
  return null;
}

// ─── CLI setup ──────────────────────────────────────────────────────────────

const rl = createReadline();
const write = createPinnedWrite(rl);

let conversationHistory = [];

// Try to restore previous session
const saved = loadSession();
if (saved && Array.isArray(saved) && saved.length > 0) {
  conversationHistory = saved;
  write(formatSessionRestored(saved.length));
} else {
  write(formatBanner());
}
write(formatUsageHint());

rl.prompt();

// ─── Input handler ──────────────────────────────────────────────────────────

// Multi-line state
let multiLineBuffer = [];
let isMultiLine = false;

// Patterns that suggest the input is the start of a code block (needs continuation)
const CODE_START = /^(function\s|class\s|import\s|export\s|const\s|let\s|var\s|if\s|for\s|while\s|async\s|return\s|try\s|catch\s|@|[ \t].*[{([=:]|```)/;
const MULTILINE_END = "```";

function looksLikeCodeBlock(line) {
  return CODE_START.test(line);
}

async function processInput(input) {
  if (input === "exit") {
    saveSession(conversationHistory);
    write(formatExit(conversationHistory.length));
    rl.close();
    return;
  }

  if (input === "clear" || input === "/clear") {
    conversationHistory = [];
    saveSession([]);
    write(formatCleared());
    rl.prompt();
    return;
  }

  // ── /checkpoint: manually save a checkpoint ────────────────────────
  if (input.trim() === "/checkpoint") {
    const label = saveCheckpoint(conversationHistory, "manual");
    write(chalk.green(`  ✓ Checkpoint saved: ${label}\n\n`));
    rl.prompt();
    return;
  }

  // ── /undo: restore to latest checkpoint ────────────────────────────
  if (input.trim() === "/undo") {
    const restored = restoreCheckpoint(listCheckpoints().pop()?.name);
    if (restored) {
      conversationHistory = restored;
      saveSession(conversationHistory);
      write(chalk.yellow("  ↺ Restored to last checkpoint.\n\n"));
    } else {
      write(chalk.dim("  No checkpoints found.\n\n"));
    }
    rl.prompt();
    return;
  }

  // ── /checkpoints: list all checkpoints ─────────────────────────────
  if (input.trim() === "/checkpoints") {
    const cps = listCheckpoints();
    if (cps.length === 0) {
      write(chalk.dim("  No checkpoints yet.\n\n"));
    } else {
      cps.forEach((cp, i) => {
        write(`  ${chalk.cyan(i + 1)}. ${cp.name} (${cp.messages} msgs)\n`);
      });
      write("\n");
    }
    rl.prompt();
    return;
  }

  // ── /language command: interactive language selector ────────────────
  if (input.trim().toLowerCase() === "/language") {
    const changed = await showLanguageSelector(rl);
    if (changed) {
      // Re-display banner and hint in the new language
      write(formatBanner());
      write(formatUsageHint());
    }
    rl.prompt();
    return;
  }

  write("\n");

  try {
    let streamed = false;

    // Reset display state on each new turn
    resetCodeBlockState();
    resetThinkingState();

    const { answer, messages } = await runAgent(input, conversationHistory, {
      onContent(text) {
        streamed = true;
        process.stdout.write(highlightStream(text));
      },
      onThinking(text) {
        process.stdout.write(formatThinking(text));
      },
      async onConfirm(toolName, summary) {
        process.stdout.write("\n" + formatConfirmPrompt(toolName, summary) + "\n");
        const result = await showConfirmSelector(rl);
        return result; // "allow" | "allow_all" | "deny"
      },
      onCheckpoint(toolName, args) {
        const summary = `${toolName}: ${JSON.stringify(args).slice(0, 80)}`;
        saveCheckpoint(conversationHistory, summary);
      },
    });

    conversationHistory = messages.slice(1);
    saveSession(conversationHistory);

    if (!streamed) {
      write(highlightStream(answer));
    }
    write(formatThinkingEnd() + formatTurnSummary(getTurnSummary()));
  } catch (err) {
    write(formatError(err.message));
    saveSession(conversationHistory);
  }
}

rl.on("line", async (line) => {
  // ── Multi-line input mode ──────────────────────────────────────────
  if (isMultiLine) {
    // Check for end marker (empty line or ```)
    if (line.trim() === "" || line.trim() === MULTILINE_END) {
      isMultiLine = false;
      setNormalPrompt(rl);
      const fullInput = multiLineBuffer.join("\n");
      multiLineBuffer = [];
      await processInput(fullInput);
      rl.prompt();
      return;
    }
    multiLineBuffer.push(line);
    setMultiLinePrompt(rl);
    rl.prompt();
    return;
  }

  // ── Check if this line starts a multi-line input ───────────────────
  const trimmed = line.trim();

  if (trimmed === "" || trimmed === "exit" || trimmed === "clear" || trimmed.startsWith("/")) {
    // These are always single-line commands
    const input = trimmed;
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit") {
      await processInput(input);
      return;
    }
    if (input === "clear") {
      await processInput(input);
      rl.prompt();
      return;
    }
    if (input.startsWith("/")) {
      await processInput(input);
      rl.prompt();
      return;
    }
  }

  // If input looks like a code block start, enter multi-line mode
  if (looksLikeCodeBlock(line)) {
    isMultiLine = true;
    multiLineBuffer = [line];
    setMultiLinePrompt(rl);
    write(formatMultiLineHint());
    rl.prompt();
    return;
  }

  // Normal single-line input
  await processInput(trimmed);
  rl.prompt();
});

rl.on("close", () => {
  process.exit(0);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  write("\n\n" + formatShutdown(signal));
  saveSession(conversationHistory);

  const stats = getSessionStats();
  write(formatShutdownStats(stats, conversationHistory.length) + "\n");

  rl.close();
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
