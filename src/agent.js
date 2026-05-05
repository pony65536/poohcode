import { chatStream } from "./llm.js";
import { toolDefinitions, executeTool } from "./tools/index.js";
import { getSandboxInfo, executeSandboxedCommand } from "./sandbox.js";
import { manageContext, estimateMessagesTokens } from "./context.js";
import { detectProject } from "./project.js";
import { formatMemoriesForPrompt } from "./memory.js";
import { get } from "./config.js";
import { unifiedDiff } from "./diff.js";
import { readFile } from "node:fs/promises";
import { resolveSafePath } from "./sandbox.js";

const MAX_ITERATIONS = get("agent.maxIterations", 25);
const MAX_VERIFY_ITERATIONS = 2;

// Tools that modify state — require user confirmation before execution
const DESTRUCTIVE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "execute_in_shell",
]);

// Command execution tools — safe commands run without confirmation, others require it
// These are considered safe (read-only or low-risk)
const SAFE_COMMANDS = new Set([
  "node", "npm", "npx", "yarn", "pnpm",
  "git", "ls", "cat", "head", "tail", "grep", "find", "wc",
  "echo", "printf", "pwd", "which", "type", "where",
  "python", "python3", "pip", "pip3",
  "go", "rustc", "cargo",
  "cmake", "mingw32-make",
  "curl", "wget", "tar", "zip", "unzip", "gzip", "gunzip",
  "chkdsk", "ver", "systeminfo",
  "dir", "copy", "xcopy", "robocopy", "attrib", "icacls", "takeown",
  "sort", "findstr", "where", "fc",
  "cmd", "powershell", "pwsh",
]);

const sandboxInfo = getSandboxInfo();
const projectInfo = detectProject(sandboxInfo.workspace);

function buildSystemPrompt(sandbox, project) {
  const isWin = sandbox.platform === "win32";

  const platformTips = isWin
    ? `- On Windows, use \`execute_in_shell\` for cmd.exe built-in commands (type, dir, copy, etc.) or PowerShell commands.
- Use \`execute_command\` (no shell) for standalone executables like node, git, python, etc.`
    : `- Use \`execute_command\` (no shell, preferred) or \`execute_in_shell\` (with shell features) to run commands.`;

  const memories = formatMemoriesForPrompt();

  return `You are a helpful coding agent. You help users with programming tasks by reading and searching code, understanding architecture, and making changes.

## Project Context
${project.summary}
${project.entryFile ? `Entry point: ${project.entryFile}` : ""}
${memories ? `\n## Persistent Memories\n${memories}\nUse the remember tool to save new facts or update existing ones.` : `\nNo persistent memories yet. Use the remember tool to store user preferences, project conventions, and important decisions.`}

## How to work

### 1. Plan first (ALWAYS)
Before writing ANY code, use todo_write to create a task list. Break the user's request into concrete sub-tasks. This keeps you organized and shows the user what you're doing. Mark each task as in_progress before starting it, and completed when done.

### 2. Read and search to understand
Before making changes, read relevant files and use search_code to find where symbols appear. Understand the architecture first.

### 3. Make focused edits
Make small, surgical changes. Use edit_file for targeted replacements (preferred) or write_file for new files. Edit one thing at a time.

### 4. Verify EVERY change (CRITICAL)
After EACH edit, you MUST verify:
- Run the linter/formatter if available${project.lintTools.length > 0 ? " (" + project.lintTools.join(", ") + ")" : ""}
- Run the test suite if available${project.testFramework ? " (" + project.testFramework + ")" : ""}
- Use \`execute_command\` to check for syntax or type errors
- Use \`git diff\` to review your changes
If something fails, fix it BEFORE moving to the next task. Never leave broken code.

### 5. Use git
Use the git tool to check status before/after changes. Review diffs to confirm exactly what was modified.

## Context summaries
You may see messages prefixed with "[Previous context summary". These are compressed transcripts of earlier conversation. Treat them as factual context.

## Sandbox Environment
- Workspace: ${sandbox.workspace}
- All file operations are restricted to the workspace.
${platformTips}
- Allowed commands: ${sandbox.allowedCommands.join(", ")}
- Docker sandbox: ${sandbox.useDocker ? "enabled" : "disabled"}
- Platform: ${sandbox.platform}`;
}

const SYSTEM_PROMPT = buildSystemPrompt(sandboxInfo, projectInfo);

/**
 * Run the agent with the given user input.
 */
export async function runAgent(userMessage, conversationHistory = [], callbacks = {}) {
  const { onContent, onToolStart, onToolEnd, onConfirm, onToolStartBatch, onToolEndBatch, onThinking, onDone, onCheckpoint } = callbacks;

  let messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  let iterations = 0;
  let verifyIterations = 0;
  let lastContextCheck = 0;
  let lastTokenCount = estimateMessagesTokens(messages);

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // ── Context window management (throttled) ──────────────────────────
    const currentTokens = estimateMessagesTokens(messages);
    const tokenGrowth = lastTokenCount > 0
      ? (currentTokens - lastTokenCount) / currentTokens
      : 1;
    const shouldCheck = iterations - lastContextCheck >= 5 || tokenGrowth > 0.20;

    if (shouldCheck) {
      const beforeTokens = currentTokens;
      messages = await manageContext(messages);
      const afterTokens = estimateMessagesTokens(messages);
      if (afterTokens < beforeTokens) {
        const saved = beforeTokens - afterTokens;
        const pct = Math.round((saved / beforeTokens) * 100);
        if (process.env.POOHCODE_LOG !== "false") {
          console.log(`  [CTX] Trimmed ~${pct}% context (${beforeTokens.toLocaleString()} → ${afterTokens.toLocaleString()} tokens)`);
        }
      }
      lastContextCheck = iterations;
      lastTokenCount = afterTokens;
    }

    // Collect the streamed content for the final message
    let streamedContent = "";

    const stream = chatStream(messages, { tools: toolDefinitions });

    let doneMessage = null;
    try {
      for await (const chunk of stream) {
        if (chunk.type === "reasoning") {
          if (onThinking) onThinking(chunk.text);
        }
        if (chunk.type === "content") {
          streamedContent += chunk.text;
          if (onContent) onContent(chunk.text);
        }
        if (chunk.type === "done") {
          doneMessage = chunk.message;
          if (!doneMessage.tool_calls && streamedContent) {
            doneMessage.content = streamedContent;
          }
        }
      }
    } catch (streamErr) {
      throw new Error(`LLM stream error: ${streamErr.message}`);
    }

    if (!doneMessage) {
      throw new Error("LLM stream ended without a response. The connection may have been interrupted or the API returned an empty response.");
    }

    const response = doneMessage;

    if (response.tool_calls && response.tool_calls.length > 0) {
      messages.push(response);

      // ── Parse all tool calls ──────────────────────────────────────────
      const parsed = [];
      for (const toolCall of response.tool_calls) {
        const fn = toolCall.function;
        try {
          parsed.push({ toolCall, fn, args: JSON.parse(fn.arguments), error: null });
        } catch (err) {
          parsed.push({ toolCall, fn, args: null, error: `Error parsing arguments: ${err.message}` });
        }
      }

      // ── Notify parse errors immediately ────────────────────────────────
      for (const p of parsed) {
        if (p.error) {
          if (onToolStart) onToolStart(p.fn.name, p.fn.arguments);
          if (onToolEnd) onToolEnd(p.error);
          messages.push({ role: "tool", tool_call_id: p.toolCall.id, content: p.error });
        }
      }

      // ── Group tools by type ────────────────────────────────────────────
      const readOnly = parsed.filter(p => !p.error && !DESTRUCTIVE_TOOLS.has(p.fn.name) && p.fn.name !== "execute_command");
      const commandTools = parsed.filter(p => !p.error && p.fn.name === "execute_command");
      let destructive = parsed.filter(p => !p.error && DESTRUCTIVE_TOOLS.has(p.fn.name));

      // ── Execute read-only tools in parallel (no confirmation needed) ───
      if (readOnly.length > 0) {
        // Notify batch start
        if (onToolStartBatch) onToolStartBatch(
          readOnly.map(p => ({ name: p.fn.name, args: p.args }))
        );

        const results = await Promise.all(
          readOnly.map(async (p) => {
            try {
              const result = await executeTool(p.fn.name, p.args);
              const resultStr = String(result);
              return { id: p.toolCall.id, content: resultStr };
            } catch (err) {
              return { id: p.toolCall.id, content: `Error executing tool "${p.fn.name}": ${err.message}` };
            }
          })
        );

        // Notify batch end
        if (onToolEndBatch) onToolEndBatch(
          results.map(r => r.content)
        );

        for (const r of results) {
          messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
        }
      }

      // ── Execute command tools (safe commands auto-run, others ask) ────
      for (const p of commandTools) {
        const cmd = (p.args.command || "").trim().split(/\s+/)[0];
        const isSafe = SAFE_COMMANDS.has(cmd);

        if (!isSafe && onConfirm) {
          // Notify tool start
          if (onToolStartBatch) onToolStartBatch([{ name: p.fn.name, args: p.args }]);

          const summary = buildConfirmationSummary(p.fn.name, p.args);
          const result = await onConfirm(p.fn.name, summary);
          if (result === "allow") {
            // proceed
          } else if (result === "allow_all") {
            // proceed, mark this session
            confirmAlways = true;
          } else {
            const deniedMsg = "User denied this action. Do not retry the same operation. Suggest an alternative approach or ask the user what they'd prefer.";
            if (onToolEndBatch) onToolEndBatch([deniedMsg]);
            messages.push({ role: "tool", tool_call_id: p.toolCall.id, content: deniedMsg });
            continue;
          }
        }

        let toolResult;
        try {
          toolResult = String(await executeTool(p.fn.name, p.args));
        } catch (err) {
          toolResult = `Error executing tool "${p.fn.name}": ${err.message}`;
        }
        if (onToolEndBatch) onToolEndBatch([toolResult]);
        messages.push({ role: "tool", tool_call_id: p.toolCall.id, content: toolResult });
      }

      // ── Execute destructive tools sequentially (with confirmation) ────
      let confirmAlways = false; // if user chose "always allow this session"
      for (const p of destructive) {
        // Auto-checkpoint before destructive action
        if (onCheckpoint) onCheckpoint(p.fn.name, p.args);

        // Notify single tool start
        if (onToolStartBatch) onToolStartBatch([{ name: p.fn.name, args: p.args }]);

        if (onConfirm) {
          let approved = false;
          if (confirmAlways) {
            approved = true;
          } else {
            const summary = buildConfirmationSummary(p.fn.name, p.args);
            const result = await onConfirm(p.fn.name, summary);
            if (result === "allow_all") {
              approved = true;
              confirmAlways = true;
            } else if (result === "allow") {
              approved = true;
            } else {
              approved = false;
            }
          }
          if (!approved) {
            const deniedMsg = "User denied this action. Do not retry the same operation. Suggest an alternative approach or ask the user what they'd prefer.";
            if (onToolEndBatch) onToolEndBatch([deniedMsg]);
            messages.push({ role: "tool", tool_call_id: p.toolCall.id, content: deniedMsg });
            continue;
          }
        }

        let toolResult;
        try {
          toolResult = String(await executeTool(p.fn.name, p.args));
        } catch (err) {
          toolResult = `Error executing tool "${p.fn.name}": ${err.message}`;
        }
        if (onToolEndBatch) onToolEndBatch([toolResult]);
        messages.push({ role: "tool", tool_call_id: p.toolCall.id, content: toolResult });
      }

      // ── Auto-verify after code modifications ──────────────────────────
      if (verifyIterations < MAX_VERIFY_ITERATIONS) {
        const codeTools = [...readOnly, ...destructive].filter(p =>
          p.fn.name === "write_file" || p.fn.name === "edit_file"
        );
        if (codeTools.length > 0) {
          const verifyResults = await runAutoVerify(projectInfo, sandboxInfo);
          if (verifyResults.length > 0) {
            verifyIterations++;
            for (const r of verifyResults) {
              messages.push({ role: "tool", tool_call_id: "verify", content: r });
            }
            continue;
          }
        }
      }

      continue;
    }

    // Final text response
    const answer = streamedContent || response.content || "";
    if (onDone) onDone(messages);
    return { answer, messages };
  }

  const finalAnswer = "Reached the maximum number of tool-calling iterations. The task may be too complex or the model is stuck in a loop. Please try breaking it into smaller steps.";
  if (onDone) onDone(messages);
  return {
    answer: finalAnswer,
    messages,
  };
}

function buildConfirmationSummary(toolName, args) {
  switch (toolName) {
    case "write_file":
      return `Write file: ${args.path}\nContent length: ${(args.content || "").length} chars`;
    case "edit_file":
      return `Edit file: ${args.path}\nReplace: "${(args.old || "").slice(0, 80)}${(args.old || "").length > 80 ? "..." : ""}"\nWith: "${(args.new || "").slice(0, 80)}${(args.new || "").length > 80 ? "..." : ""}"`;
    case "execute_command":
      return `Run command: ${args.command} ${(args.args || []).join(" ")}`;
    case "execute_in_shell":
      return `Run shell command: ${args.command}`;
    default:
      return `${toolName}: ${JSON.stringify(args).slice(0, 200)}`;
  }
}

async function runAutoVerify(project, sandbox) {
  const results = [];
  const cwd = sandbox.workspace;

  // ── Lint ────────────────────────────────────────────────────────────
  try {
    if (project.lintTools.includes("eslint")) {
      const r = await executeSandboxedCommand("npx", ["eslint", "."], { cwd, timeout: 30000 });
      if (r.exitCode !== 0 && r.stderr) {
        results.push(`[AUTO-VERIFY] Lint found issues:\n${r.stderr.slice(0, 2000)}`);
      } else if (r.exitCode !== 0 && r.stdout) {
        results.push(`[AUTO-VERIFY] Lint found issues:\n${r.stdout.slice(0, 2000)}`);
      }
    }
  } catch (err) {
    // Lint unavailable or failed, skip
  }

  // ── Tests ───────────────────────────────────────────────────────────
  try {
    if (project.testFramework && project.testFramework !== "npm run test (unknown)") {
      let cmd = "npm";
      let cargs = ["test"];
      if (project.testFramework === "vitest") { cmd = "npx"; cargs = ["vitest", "run"]; }
      else if (project.testFramework === "jest") { cmd = "npx"; cargs = ["jest"]; }
      else if (project.testFramework === "pytest") { cmd = "python"; cargs = ["-m", "pytest"]; }
      else if (project.testFramework === "go test") { cmd = "go"; cargs = ["test", "./..."]; }

      const r = await executeSandboxedCommand(cmd, cargs, { cwd, timeout: 60000 });
      if (r.exitCode !== 0) {
        const output = (r.stdout || "") + (r.stderr || "");
        results.push(`[AUTO-VERIFY] Tests failed. Fix the issues and try again:\n${output.slice(0, 3000)}`);
      }
    }
  } catch (err) {
    // Tests unavailable or failed, skip
  }

  return results;
}
