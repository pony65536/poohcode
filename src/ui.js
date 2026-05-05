/**
 * UI utilities — centralized styling and rendering for the CLI.
 *
 * Uses chalk@5 (ESM), boxen, cli-table3.
 * All text is translated via src/lang.js.
 */
import chalk from "chalk";
import hljs from "highlight.js";
import { createInterface, cursorTo, clearLine } from "node:readline";
import { env } from "node:process";
import { t, getLang, setLang, LANGUAGES, getCurrentLangName } from "./lang.js";

// ─── Re-export chalk & lang helpers ──────────────────────────────────────────

export { chalk, getLang, setLang, LANGUAGES, getCurrentLangName };

// ─── Semantic color shortcuts ─────────────────────────────────────────────────

export const style = {
  dim: chalk.dim,
  bold: chalk.bold,
  italic: chalk.italic,
  underline: chalk.underline,
  info: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  highlight: chalk.magenta,
  code: chalk.yellow,
  muted: chalk.gray,
  accent: chalk.blue,
};

// ─── Banner ───────────────────────────────────────────────────────────────────

const BANNER_LINES = [
  chalk.bold.cyan("  ╔══════════════════════════════════════╗"),
  chalk.bold.cyan("  ║") + chalk.bold.white("       🐻  PoohCode  v0.1.0         ") + chalk.bold.cyan("║"),
  chalk.bold.cyan("  ╚══════════════════════════════════════╝"),
];

export function formatBanner() {
  return "\n" + BANNER_LINES.join("\n") + "\n\n";
}

// ─── Session restore ──────────────────────────────────────────────────────────

export function formatSessionRestored(count) {
  const msg = t("session.restored", { count: chalk.bold(String(count)) });
  return "\n" +
    chalk.green("╭─ ") + chalk.bold.green(t("session.restoredTitle")) + "\n" +
    chalk.green("│ ") + msg + "\n" +
    chalk.green("╰" + "─".repeat(36)) + "\n\n";
}

// ─── Usage hint ───────────────────────────────────────────────────────────────

export function formatUsageHint() {
  const hint = [
    t("usage.exit"),
    t("usage.clear"),
    t("usage.language"),
  ];
  return "\n" + hint.map(line => chalk.dim("  " + line)).join("\n") + "\n\n";
}

// ─── Syntax highlighting helpers ─────────────────────────────────────────────

// Ensure chalk produces ANSI codes even when output is not a TTY (e.g. pipes)
chalk.level = env.CI ? Math.max(chalk.level, 2) : Math.max(chalk.level, 1);

const HLJS_TO_CHALK = {
  "hljs-keyword": chalk.magenta,
  "hljs-literal": chalk.yellow,
  "hljs-number": chalk.yellow,
  "hljs-string": chalk.green,
  "hljs-comment": chalk.gray.italic,
  "hljs-title function_": chalk.cyan,
  "hljs-title class_": chalk.cyan,
  "hljs-title": chalk.cyan,
  "hljs-built_in": chalk.cyan,
  "hljs-type": chalk.cyan,
  "hljs-attr": chalk.yellow,
  "hljs-params": chalk.dim,
  "hljs-meta": chalk.dim,
  "hljs-regexp": chalk.red,
  "hljs-selector-class": chalk.cyan,
  "hljs-selector-id": chalk.cyan,
  "hljs-template-variable": chalk.yellow,
  "hljs-variable language_": chalk.white,
};

function htmlToChalk(html) {
  let out = "";
  let i = 0;
  let currentStyle = null; // track the active chalk style function
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      const tag = html.slice(i, end + 1);
      if (tag.startsWith("</span")) {
        out += chalk.reset("");
        currentStyle = null;
      } else {
        const m = tag.match(/class="([^"]*)"/);
        if (m) {
          const cls = m[1];
          const fn = HLJS_TO_CHALK[cls] || HLJS_TO_CHALK[cls.split(" ")[0]];
          currentStyle = fn; // save style for the upcoming text
        }
      }
      i = end + 1;
    } else if (html[i] === "&") {
      const end = html.indexOf(";", i);
      const map = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#x27;": "'" };
      out += map[html.slice(i, end + 1)] || html.slice(i, end + 1);
      i = end + 1;
    } else {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      const text = html.slice(i, end);
      // apply current style to the text chunk
      if (currentStyle) {
        out += currentStyle(text);
      } else {
        out += text;
      }
      i = end;
    }
  }
  return out;
}

function highlightLine(line, lang) {
  if (!lang || !line || !hljs.getLanguage(lang)) return chalk.dim(line);
  try {
    const result = hljs.highlight(line, { language: lang, ignoreIllegals: true });
    return htmlToChalk(result.value);
  } catch {
    return chalk.dim(line);
  }
}

// ─── Markdown syntax highlighting (streaming) ────────────────────────────────

// Stateful code block detection during streaming
let inCodeBlock = false;
let codeBlockLang = "";
let codeLineBuffer = "";
let codeBlockLangBuffer = ""; // buffer for lang name when ``` and lang arrive in separate chunks
let inBold = false;

/**
 * Apply terminal-friendly Markdown formatting to streamed text.
 *
 * Rules (in priority order, processed character-by-character):
 *   ```code block``` → dimmed monospace feel
 *   `inline code`   → yellow
 *   **bold**        → chalk.bold
 *   *italic*        → chalk.italic
 *   # heading       → bold + cyan
 *   ## sub-heading  → bold + blue
 *   ### sub-sub     → bold + blue (dim)
 *   - list          → prepend bullet with cyan dash
 *   --- HR          → dim line
 *   [text](url)     → underline link text + dim URL
 *   > blockquote    → gray italic
 */
export function highlightStream(text) {
  let result = "";

  for (let i = 0; i < text.length; i++) {
    // ── Code block fences ────────────────────────────────────────────
    if (text.startsWith("```", i)) {
      const nl = text.indexOf("\n", i);
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = text.slice(i + 3, nl === -1 ? text.length : nl).trim();
        codeBlockLangBuffer = "";
        codeLineBuffer = "";
      } else {
        // Flush the last buffered line
        result += highlightLine(codeLineBuffer, codeBlockLang) + "\n";
        codeLineBuffer = "";
        inCodeBlock = false;
        codeBlockLang = "";
        codeBlockLangBuffer = "";
      }
      i = nl !== -1 ? nl : text.length;
      continue;
    }

    // ── Inside code block: line-by-line syntax highlighting ──────────
    if (inCodeBlock) {
      if (text[i] === "\n") {
        // If we entered code block but lang was empty (``` arrived without lang),
        // the first line might be the language name — capture it
        if (!codeBlockLang && codeBlockLangBuffer === "" && codeLineBuffer.trim()) {
          // Check if this line looks like a language identifier
          const possibleLang = codeLineBuffer.trim().toLowerCase();
          if (hljs.getLanguage(possibleLang)) {
            codeBlockLang = possibleLang;
            codeLineBuffer = "";
            continue;
          }
        }

        result += highlightLine(codeLineBuffer, codeBlockLang) + "\n";
        codeLineBuffer = "";
      } else {
        codeLineBuffer += text[i];
      }
      continue;
    }

    // ── Inline code (`...`) ──────────────────────────────────────────
    if (text[i] === "`") {
      i++;
      let inline = "";
      while (i < text.length && text[i] !== "`") {
        inline += text[i];
        i++;
      }
      result += chalk.yellow(inline);
      continue;
    }

    // ── Markdown bold (**text**) ─────────────────────────────────────
    if (text[i] === "*" && i + 1 < text.length && text[i + 1] === "*") {
      if (!inBold) {
        inBold = true;
        result += chalk.bold("");
        i += 1;
      } else {
        inBold = false;
        result += chalk.reset("");
        i += 1;
      }
      continue;
    }

    // ── Markdown italic (*text*) — but NOT **bold** ─────────────────
    // Only toggle italic when * is adjacent to a word character on one side
    // (markdown spec: opening * before word char, closing * after word char).
    // This avoids false triggers on literal * like "2 * 3 = 6".
    if (text[i] === "*" && !inBold && (i + 1 >= text.length || text[i + 1] !== "*")) {
      const prevChar = i > 0 ? text[i - 1] : " ";
      const nextChar = i + 1 < text.length ? text[i + 1] : " ";
      const isWordBoundary = /\w/.test(prevChar) !== /\w/.test(nextChar);
      if (isWordBoundary) {
        if (!_inItalic) {
          _inItalic = true;
          result += chalk.italic("");
          continue;
        } else {
          _inItalic = false;
          result += chalk.reset("");
          continue;
        }
      }
    }

    // ── Headings (# ## ### etc.) — entire line ───────────────────────
    if (text[i] === "#" && _isAtLineStart(text, i)) {
      let level = 0;
      while (i + level < text.length && text[i + level] === "#") level++;
      if (level >= 1 && level <= 6) {
        const afterHash = i + level;
        const hasSpace = afterHash < text.length && text[afterHash] === " ";
        const headingColor = level === 1 ? chalk.bold.cyan
                          : level === 2 ? chalk.bold.blue
                          : chalk.cyan;
        let lineEnd = text.indexOf("\n", i);
        if (lineEnd === -1) lineEnd = text.length;
        const contentStart = hasSpace ? afterHash + 1 : afterHash;
        result += headingColor(text.slice(contentStart, lineEnd));
        i = lineEnd - 1;
        continue;
      }
    }

    // ── List items (- * at line start) ───────────────────────────────
    if ((text[i] === "-" || text[i] === "*") && _isAtLineStart(text, i) && _followedBySpace(text, i)) {
      result += chalk.cyan("  • ");
      i++; // skip the space after dash/star
      continue;
    }

    // Numbered list (1. 2. etc.)
    if (/\d/.test(text[i]) && _isAtLineStart(text, i) && _looksLikeNumberedList(text, i)) {
      let numEnd = i;
      while (numEnd < text.length && /\d/.test(text[numEnd])) numEnd++;
      // numEnd points to the dot; skip "N. " and replace with "  N. "
      result += chalk.cyan(" " + text.slice(i, numEnd + 1) + " ");
      i = numEnd + (text[numEnd + 1] === " " ? 1 : 0); // skip dot + space
      continue;
    }

    // ── Blockquote (>) — entire line ─────────────────────────────────
    if (text[i] === ">" && _isAtLineStart(text, i)) {
      let lineEnd = text.indexOf("\n", i);
      if (lineEnd === -1) lineEnd = text.length;
      const contentStart = text[i + 1] === " " ? i + 2 : i + 1;
      result += chalk.gray.italic("│ ") + chalk.gray.italic(text.slice(contentStart, lineEnd));
      i = lineEnd - 1;
      continue;
    }

    // ── Horizontal rule (---, ***, ___) ──────────────────────────────
    if (_isHR(text, i)) {
      let hrEnd = text.indexOf("\n", i);
      if (hrEnd === -1) hrEnd = text.length;
      result += chalk.dim("─".repeat(40));
      i = hrEnd - 1;
      continue;
    }

    // ── Tables (| col1 | col2 | ... |) ────────────────────────────
    if (_isTableLine(text, i)) {
      let rowEnd = text.indexOf("\n", i);
      if (rowEnd === -1) rowEnd = text.length;
      const line = text.slice(i, rowEnd);

      // Check if this is a separator line (|---|---|) → skip it
      if (_isTableSeparator(text, i)) {
        i = rowEnd - 1;
        continue;
      }

      // Parse cells: split by | but ignore leading/trailing empty
      let rawCells = line.split("|");
      if (line.startsWith("|")) rawCells = rawCells.slice(1);
      if (line.endsWith("|")) rawCells = rawCells.slice(0, -1);
      const cells = rawCells.map(c => c.trim());

      // Render as a formatted table row with chalk.cyan for borders
      result += chalk.cyan("| ") + cells.map(c => chalk.white(c)).join(chalk.cyan(" | ")) + chalk.cyan(" |");
      i = rowEnd - 1;
      continue;
    }

    // ── Links [text](url) ────────────────────────────────────────────
    if (text[i] === "[" && _isLink(text, i)) {
      const closeB = text.indexOf("]", i);
      const openP = text.indexOf("(", closeB);
      const closeP = text.indexOf(")", openP);
      if (closeB !== -1 && openP !== -1 && closeP !== -1) {
        const linkText = text.slice(i + 1, closeB);
        const url = text.slice(openP + 1, closeP);
        result += chalk.underline(linkText) + chalk.dim(` (${url})`);
        i = closeP;
        continue;
      }
    }

    // ── Markdown strikethrough (~~text~~) ────────────────────────────
    if (text[i] === "~" && i + 1 < text.length && text[i + 1] === "~") {
      if (!_inStrikethrough) {
        _inStrikethrough = true;
        result += chalk.strikethrough("");
        i += 1;
      } else {
        _inStrikethrough = false;
        result += chalk.reset("");
        i += 1;
      }
      continue;
    }

    // ── Markdown highlight (==text==) — rendered as inverse ──────────
    if (text[i] === "=" && i + 1 < text.length && text[i + 1] === "=") {
      if (!_inHighlight) {
        _inHighlight = true;
        result += chalk.inverse("");
        i += 1;
      } else {
        _inHighlight = false;
        result += chalk.reset("");
        i += 1;
      }
      continue;
    }

    // ── Fallthrough: normal character ────────────────────────────────
    // Apply current active styles
    if (_inStrikethrough) {
      result += chalk.strikethrough(text[i]);
    } else if (_inHighlight) {
      result += chalk.inverse(text[i]);
    } else {
      result += text[i];
    }
  }

  if (inBold) result += chalk.reset("");
  if (_inItalic) { _inItalic = false; result += chalk.reset(""); }
  if (_inStrikethrough) { _inStrikethrough = false; result += chalk.reset(""); }
  if (_inHighlight) { _inHighlight = false; result += chalk.reset(""); }
  return result;
}

// ─── Italic state (separate from bold) ───────────────────────────────────────
let _inItalic = false;
let _inStrikethrough = false;
let _inHighlight = false;

export function resetCodeBlockState() {
  inCodeBlock = false;
  codeBlockLang = "";
  codeLineBuffer = "";
  codeBlockLangBuffer = "";
  inBold = false;
  _inItalic = false;
  _inStrikethrough = false;
  _inHighlight = false;
}

// ─── Line-start helpers ──────────────────────────────────────────────────────

function _isAtLineStart(text, i) {
  return i === 0 || text[i - 1] === "\n";
}

function _followedBySpace(text, i) {
  return i + 1 < text.length && text[i + 1] === " ";
}

function _looksLikeNumberedList(text, i) {
  let j = i;
  while (j < text.length && /\d/.test(text[j])) j++;
  return j < text.length && text[j] === ".";
}

function _isHR(text, i) {
  // Only detect at line start
  if (!_isAtLineStart(text, i)) return false;
  const ch = text[i];
  if (ch !== "-" && ch !== "*" && ch !== "_") return false;
  // Count consecutive same char
  let count = 0;
  let j = i;
  while (j < text.length && (text[j] === ch || text[j] === " ")) {
    if (text[j] === ch) count++;
    j++;
  }
  // HR needs at least 3 same chars and then newline or end
  return count >= 3 && (j >= text.length || text[j] === "\n");
}

function _isTableLine(text, i) {
  // Must be at line start
  if (!_isAtLineStart(text, i)) return false;
  // Find end of line
  let lineEnd = text.indexOf("\n", i);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(i, lineEnd);
  // Table: starts with | and has at least one more |
  // Also: a separator line like |---|---|
  if (!line.includes("|", 1)) return false;
  // Check for at least one pipe not at the very start (or at start is fine)
  const pipeCount = (line.match(/\|/g) || []).length;
  return pipeCount >= 2;
}

function _isTableSeparator(text, i) {
  if (!_isAtLineStart(text, i)) return false;
  let lineEnd = text.indexOf("\n", i);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(i, lineEnd).trim();
  // Separator: |---|---| or |:---|---:| etc.
  return /^\|[\s:]*-+[\s:]*\|/.test(line);
}

function _isLink(text, i) {
  // Check if this [ is actually a markdown link: must have ]( followed by )
  const closeB = text.indexOf("]", i);
  if (closeB === -1) return false;
  const openP = text.indexOf("(", closeB);
  if (openP === -1 || openP !== closeB + 1) return false;
  const closeP = text.indexOf(")", openP);
  return closeP !== -1;
}

// ─── Confirmation dialog ─────────────────────────────────────────────────────

export function formatConfirmPrompt(toolName, summary) {
  const lines = [
    chalk.yellow("🔍") + chalk.bold.yellow(t("confirm.title", { name: toolName })),
    chalk.dim("  " + summary.replace(/\n/g, "\n  ")),
  ];
  return lines.join("\n");
}

export function formatDenied() {
  return chalk.red("  ✗") + chalk.dim(t("confirm.denied"));
}

export function formatAllowed() {
  return chalk.green("  ✓") + chalk.dim(t("confirm.allowed"));
}

export function formatAllowedAll() {
  return chalk.green("  ✓✓") + chalk.dim(t("confirm.allowedAll"));
}

/**
 * Interactive arrow-key confirmation selector.
 * ←→↑↓ to navigate, Enter to select, Esc to deny.
 * No readline pause/resume — only setRawMode + keypress listener,
 * so the readline prompt never leaks.
 */
export async function showConfirmSelector(rl) {
  return new Promise((resolve) => {
    const options = [
      { key: "allow", label: t("confirm.optAllow") },
      { key: "allow_all", label: t("confirm.optAllowAll") },
      { key: "deny", label: t("confirm.optDeny") },
    ];
    let selectedIndex = 0;
    const LINES = options.length + 2; // blank + 3 options + blank = 5
    let rendered = false;

    function draw() {
      if (rendered) {
        // Move cursor up to start of the selector area
        process.stdout.write("\x1b[" + LINES + "A");
      }
      rendered = true;

      process.stdout.write(
        "\n" +
        options.map((opt, i) => {
          if (i === selectedIndex) {
            return `  ${chalk.cyan("▸")} ${chalk.bold(opt.label)}`;
          }
          return `  ${chalk.dim(" ")} ${chalk.dim(opt.label)}`;
        }).join("\n") +
        "\n\n"
      );
    }

    // Initial render
    draw();

    function onKeyPress(key, data) {
      if (!data) return;

      if (data.name === "up" || (data.ctrl && data.name === "p")) {
        selectedIndex = selectedIndex === 0 ? options.length - 1 : selectedIndex - 1;
        draw();
        return;
      }

      if (data.name === "down" || (data.ctrl && data.name === "n")) {
        selectedIndex = selectedIndex === options.length - 1 ? 0 : selectedIndex + 1;
        draw();
        return;
      }

      if (data.name === "return") {
        cleanup();
        const chosen = options[selectedIndex];
        const msg = chosen.key === "allow" ? formatAllowed()
          : chosen.key === "allow_all" ? formatAllowedAll()
          : formatDenied();
        process.stdout.write(msg + "\n\n");
        resolve(chosen.key);
        return;
      }

      if (data.name === "escape") {
        cleanup();
        process.stdout.write(formatDenied() + "\n\n");
        resolve("deny");
        return;
      }
    }

    function cleanup() {
      rl.input.removeListener("keypress", onKeyPress);
      try { rl.input.setRawMode(false); } catch { /* ignore */ }
      // Don't call resume/pause — readline manages its own flow.
      // The line handler's rl.prompt() will re-display the prompt.
    }

    try { rl.input.setRawMode(true); } catch { /* ignore */ }
    rl.input.on("keypress", onKeyPress);
  });
}

// ─── Thinking/reasoning display ────────────────────────────────────────────

/**
 * Render a chunk of reasoning/thinking text in a distinct style.
 * Uses a box with a "💭 Thinking…" header, colored in dim/italic cyan.
 *
 * The thinking block is printed once on first call and then updated in-place.
 */
let _thinkingPrinted = false;

export function resetThinkingState() {
  _thinkingPrinted = false;
}

export function formatThinking(text) {
  if (!_thinkingPrinted) {
    _thinkingPrinted = true;
    // Print the header + first chunk
    return (
      "\n" +
      chalk.dim("┌─ ") +
      chalk.cyan.dim.italic("💭 " + t("thinking.label")) +
      " " +
      chalk.dim("─".repeat(Math.max(4, 28 - t("thinking.label").length))) +
      "\n" +
      chalk.cyan.dim.italic("│ ") +
      text
    );
  }
  // Subsequent chunks: just the reasoning text, indented with a bar
  return chalk.cyan.dim.italic("│ ") + text;
}

export function formatThinkingEnd() {
  if (!_thinkingPrinted) return "";
  _thinkingPrinted = false;
  return chalk.dim("└─ ") + chalk.dim("─".repeat(36)) + "\n";
}

/**
 * Parse confirmation answer: empty/yes → true, anything else → false.
 */
export function parseConfirm(answer) {
  const a = answer.trim().toLowerCase();
  return a === "" || a === "y" || a === "yes";
}

// ─── Turn summary ────────────────────────────────────────────────────────────

export function formatTurnSummary(summary) {
  return chalk.dim("── ") + chalk.dim(summary);
}

// ─── Session stats table ─────────────────────────────────────────────────────

export function formatSessionStats(stats) {
  const lines = [
    chalk.dim("  " + t("stats.requests")) + "  " + chalk.white(stats.requests),
    chalk.dim("  " + t("stats.tokens")) + "  " + chalk.white(stats.totalTokensFormatted),
    chalk.dim("    · " + t("stats.prompt")) + "  " + chalk.gray(stats.promptTokensFormatted),
    chalk.dim("    · " + t("stats.completion")) + "  " + chalk.gray(stats.completionTokensFormatted),
    chalk.dim("  " + t("stats.cost")) + "  " + chalk.yellow(stats.costFormatted),
  ];
  return lines.join("\n");
}

// ─── Shutdown messages ───────────────────────────────────────────────────────

export function formatShutdown(signal) {
  return chalk.yellow(t("shutdown.received", { signal }));
}

export function formatShutdownStats(stats, msgCount) {
  return [
    chalk.dim(t("shutdown.stats", {
      requests: String(stats.requests),
      tokens: stats.totalTokensFormatted,
      cost: stats.costFormatted,
    })),
    chalk.dim(t("shutdown.saved", { count: String(msgCount) })),
  ].join("\n");
}

// ─── Exit / clear messages ───────────────────────────────────────────────────

export function formatExit(count) {
  return chalk.green(t("exit.saved")) + chalk.dim(t("exit.goodbye", { count: String(count) }));
}

export function formatCleared() {
  return chalk.yellow(t("clear.done"));
}

// ─── Error display ───────────────────────────────────────────────────────────

export function formatError(message) {
  return chalk.red(t("error.prefix") + message);
}

// ─── Context management ──────────────────────────────────────────────────────

export function formatContextTrim(pct, before, after) {
  return chalk.dim(t("context.trim", {
    pct: String(pct),
    before: before.toLocaleString(),
    after: after.toLocaleString(),
  }));
}

// ─── Language selection UI ───────────────────────────────────────────────────

/**
 * Display a numbered language selection menu.
 * Returns true if the language was changed.
 */
export async function showLanguageSelector(rl) {
  return new Promise((resolve) => {
    console.log();
    LANGUAGES.forEach((lang, i) => {
      const marker = lang.code === getLang() ? chalk.green(" ●") : chalk.dim(" ○");
      console.log(`  ${chalk.cyan(i + 1)}. ${lang.name}${marker}`);
    });
    console.log(`  ${chalk.dim("0.")} ${chalk.dim(t("lang.cancelled"))}`);
    console.log();

    rl.question(chalk.dim(t("lang.prompt") + ` [0-${LANGUAGES.length}] `), (answer) => {
      const idx = parseInt(answer.trim(), 10);
      if (isNaN(idx) || idx === 0) {
        console.log(chalk.dim(t("lang.cancelled")) + "\n");
        resolve(false);
        return;
      }
      const chosen = LANGUAGES[idx - 1];
      if (chosen) {
        setLang(chosen.code);
        console.log(chalk.green(t("lang.selected", { name: chosen.name })) + "\n");
        resolve(true);
      } else {
        console.log(chalk.dim(t("lang.cancelled")) + "\n");
        resolve(false);
      }
    });
  });
}

// ─── Readline helpers ────────────────────────────────────────────────────────

export function createReadline() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("> "),
  });
}

export function setMultiLinePrompt(rl) {
  rl.setPrompt(chalk.dim(".. "));
}

export function setNormalPrompt(rl) {
  rl.setPrompt(chalk.cyan("> "));
}

export function formatMultiLineHint() {
  return chalk.dim(t("multiline.hint")) + "\n";
}

// ─── Pinned output: keeps input line at bottom ──────────────────────────────

/**
 * Create a write function that clears the input line before writing
 * and redraws the prompt + in-progress input afterward.
 * Use this for all non-streaming output to keep the input pinned.
 */
export function createPinnedWrite(rl) {
  return function write(text) {
    // Save current input state
    const prompt = rl.getPrompt();
    const line = rl.line;
    const cursor = rl.cursor;

    // Move to a clean new line (preserves streamed content on previous lines)
    process.stdout.write("\n");
    clearLine(process.stdout, 0);
    cursorTo(process.stdout, 0);

    // Write the output
    process.stdout.write(text);
    if (text && !text.endsWith("\n")) process.stdout.write("\n");

    // Redraw input prompt + current buffer
    process.stdout.write(prompt + line);
    cursorTo(process.stdout, prompt.length + cursor);
  };
}

/**
 * Redraw the input line at cursor position. Call after raw streaming
 * output to restore the input prompt to the bottom.
 */
export function redrawInput(rl) {
  const prompt = rl.getPrompt();
  const line = rl.line;
  const cursor = rl.cursor;
  process.stdout.write("\n" + prompt + line);
  cursorTo(process.stdout, prompt.length + cursor);
}
