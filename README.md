# PoohCode

A coding agent CLI powered by DeepSeek. It reads, searches, edits, and runs code — all through a terminal conversation.

## Quick Start

```bash
cp .env.example .env          # edit with your DeepSeek API key
npm install
npm start
```

Type a question or request. The agent streams its response in real time. Destructive actions (write, edit, execute) require your confirmation.

## Architecture

```
index.js                     # CLI entry point (readline + streaming output)
src/
├── agent.js                 # Agent loop: messages → LLM → tool calls → execute → repeat
├── llm.js                   # DeepSeek API client (OpenAI SDK), streaming + retry + logging
├── sandbox.js               # Path sandbox + command execution isolation
├── context.js               # Context window management (token limits, summarization)
├── project.js               # Project auto-detection on startup
├── diff.js                  # Unified diff generator
├── memory.js                # Cross-session persistent memory
├── cost.js                  # Token usage + cost tracking
├── config.js                # Configuration loader (.poohcode/config.json)
└── tools/
    ├── index.js             # Tool registry (imports all tools, builds definitions)
    ├── list_directory.js    # List directory contents
    ├── read_file.js         # Read file with line numbers + offset/limit
    ├── write_file.js        # Write file (shows diff on overwrite)
    ├── edit_file.js         # Surgical text replacement (exact or regex)
    ├── search_code.js       # Regex search across project files with glob filters
    ├── web_search.js        # Tavily web search with current timestamp
    ├── execute_command.js   # Run a command via execFile (no shell, safe)
    ├── execute_in_shell.js  # Run a command via shell (pipes, redirects)
    ├── git.js               # Git operations: status, diff, log, branch
    ├── todo.js              # Structured task list for planning complex work
    ├── run_tests.js         # Auto-detect test runner and run tests
    └── remember.js          # Cross-session memory (save/recall/list/delete)
```

### How the agent loop works

1. Build messages: system prompt (with project context + memories) + conversation history + user input
2. Send to DeepSeek via streaming API → display text in real time
3. If the model returns `tool_calls`:
   - Parse & validate arguments
   - **Read-only tools** (search_code, read_file, etc.) → execute in **parallel** via `Promise.all`
   - **Destructive tools** (write, edit, execute) → execute **sequentially** with user **confirmation**
   - Feed results back to the model → loop to step 2
4. If the model returns a text message → display as final answer
5. Max 25 iterations to prevent infinite loops

## Tools

### File Operations

| Tool | Description |
|------|-------------|
| `list_directory` | List directory contents with name, type, and size |
| `read_file` | Read file with line numbers, supports `offset` and `limit` |
| `write_file` | Create or overwrite a file, shows unified diff on overwrite |
| `edit_file` | Targeted text replacement (exact match or regex, single or all occurrences) |
| `search_code` | Regex search across project files with glob filters, auto-skips binary files |

### Execution

| Tool | Description |
|------|-------------|
| `execute_command` | Run command via `execFile` (no shell injection). Validated against allowlist. |
| `execute_in_shell` | Run command string via system shell (supports pipes, redirects). Extra blocklist for dangerous patterns. |
| `run_tests` | Auto-detect project test runner and run tests. Supports npm scripts, jest, vitest, pytest, go test. |

### Git

| Tool | Description |
|------|-------------|
| `git` | Git operations: `status` (working tree), `diff` (staged or unstaged), `log` (recent commits), `branch` |

### Planning & Memory

| Tool | Description |
|------|-------------|
| `todo_write` | Create and update a structured task list. Model creates a plan before executing. |
| `remember` | Cross-session persistent memory. Save/recall/delete facts that survive restarts. |
| `web_search` | Tavily web search. Current timestamp is prepended to queries for timeliness. |

## Sandbox System

### Path Sandbox

All file operations are restricted to the workspace directory (default: current working directory, overridable via `POOHCODE_WORKSPACE`). The `resolveSafePath` function resolves paths and rejects any that escape the workspace via `..` or absolute paths. On Windows, path comparison is case-insensitive to match the filesystem behavior.

### Command Sandbox

Commands executed via `execute_command` are validated against an allowlist. Blocked patterns catch known-dangerous operations (fork bombs, crypto miners, reverse shells). The module:

- Uses `execFile` (no shell) to prevent injection
- Strips sensitive environment variables (API keys, tokens) before spawning
- Enforces timeouts and output size limits
- On Windows, includes cmd.exe built-in commands and PowerShell
- On Unix, includes standard GNU tools and development commands

### Docker Sandbox (Optional)

Set `POOHCODE_DOCKER_SANDBOX=true` to run commands inside Docker containers:
- `--network none` — no network access
- `--read-only` — immutable container filesystem
- `--cap-drop ALL` — drop all Linux capabilities
- `--security-opt no-new-privileges:true` — prevent privilege escalation
- Workspace mounted as read-only

## Context Window Management

The `src/context.js` module prevents the conversation from exceeding DeepSeek's 128K token limit via a three-tier strategy:

| Tier | Trigger | Action |
|------|---------|--------|
| **No-op** | < 70% (63K tokens) | Return unchanged |
| **Soft limit** | 70–85% | Truncate large tool results (>4000 chars) in old rounds, preserving the 3 most recent rounds intact |
| **Hard limit** | > 85% (76.5K) | Call the LLM to summarize old rounds into a dense compression, preserving file paths, decisions, and current state |

The module uses character-based token estimation (~4 chars/token for English, ~1.5 for CJK) and splits messages into "rounds" (each starting with a user message) for surgical cutting. If LLM summarization fails, it falls back to hard truncation. Context checks are throttled (every 5 iterations or >20% token growth) to avoid overhead.

## Streaming Output

Responses stream in real time via SSE. The `chatStream()` async generator in `llm.js` yields content deltas as they arrive, while accumulating tool calls (which arrive in fragments across multiple chunks). The CLI layer handles:

- **Text**: displayed as it arrives via `process.stdout.write`
- **Code blocks**: auto-detected and rendered with dim ANSI styling
- **Inline code**: rendered with yellow ANSI styling
- **Tool progress**: `[TOOL] name(args)` → `[TOOL] → result_summary`
- **Context trimming**: `[CTX] Trimmed ~72% context (100,273 → 28,184 tokens)`

## Reliability Features

### API Retry

`llm.js` wraps all API calls with `withRetry()`: up to 3 retries with exponential backoff (1s, 2s, 4s). Only retries on transient errors (429 rate limit, 5xx server errors, network issues). Non-retryable errors (4xx) fail immediately.

### Streaming Error Handling

The agent loop wraps the stream consumption in try-catch and guards against null `doneMessage` (stream interrupted before completion). Both errors produce descriptive messages and preserve the conversation history.

### Regex Safety

`search_code.js` and `edit_file.js` both reject patterns containing nested quantifiers (`(a+)+b`, `(x*)+`) that could cause catastrophic backtracking. Additional safeguards: max file size 500KB, per-file regex timeout 200ms, max 500 files per search.

### Output Truncation

Both stdout and stderr from command execution are truncated (5000 chars stdout, 2000 chars stderr) to prevent context explosion from verbose compiler output.

## Configuration

Create `.poohcode/config.json` to customize:

```json
{
  "model": {
    "temperature": 0.7,
    "top_p": 1.0,
    "max_tokens": 4096
  },
  "tools": {
    "searchCode": { "maxResults": 50, "maxFileSize": 524288, "maxFiles": 500 },
    "executeCommand": { "timeout": 30000, "maxOutputLength": 5000 }
  },
  "agent": {
    "maxIterations": 25,
    "confirmDestructive": true
  }
}
```

All settings are deep-merged with sensible defaults. Missing keys fall back to defaults.

## Cost Tracking

Token usage from every API call is accumulated in memory. DeepSeek pricing is applied automatically:
- `deepseek-chat`: $0.27/M input, $1.10/M output
- `deepseek-v4-flash`: $0.14/M input, $0.55/M output

After each response, a one-line summary is displayed: `2 req, 6,094 tokens, ~$0.0017`. Full session stats are shown on exit.

## Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

24 test cases across 3 suites:
- **diff.test.js** — unified diff generation (single changes, additions, removals, context lines)
- **context.test.js** — token estimation (English, CJK, mixed), message token counting, round splitting
- **sandbox.test.js** — path resolution, path traversal rejection, normalizing `..` in safe paths, SandboxError

## Session Management

### Conversation Persistence

After each response, the full conversation history is saved to `.poohcode/session.json`. On startup, if a previous session exists, it's automatically restored with: `Restored session with N messages`. `clear` command wipes both memory and disk. Graceful shutdown (Ctrl+C/SIGTERM) saves the session before exiting.

### Cross-Session Memory

The `remember` tool stores facts in `.poohcode/memory.json`. Stored facts are automatically injected into the system prompt on startup. Use for:
- Project conventions (`"this project uses 2-space indentation"`)
- User preferences (`"prefer TypeScript over JavaScript"`)
- Important architectural decisions

### Multi-line Input

Single-line input submits immediately (as before). The CLI auto-detects code blocks (starting with `function`, `class`, `import`, `const`, `if`, indentation, etc.) and enters multi-line accumulation mode. Finish with an empty line or triple backticks.

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `DEEPSEEK_API_KEY` | DeepSeek API key | (required) |
| `DEEPSEEK_BASE_URL` | API base URL | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | Model to use | `deepseek-chat` |
| `TAVILY_API_KEY` | Tavily search API key | (optional) |
| `POOHCODE_WORKSPACE` | Restricted workspace directory | current working directory |
| `POOHCODE_DOCKER_SANDBOX` | Run commands in Docker | `false` |
| `POOHCODE_LOG` | Enable LLM request logging | `true` |
| `POOHCODE_LOG_DIR` | Log directory | `./logs` |

## Design Decisions

**Why OpenAI SDK instead of direct HTTP?** DeepSeek's API is OpenAI-compatible. Using the SDK gives us streaming, retry handling, TypeScript types, and tool-calling support for free. No point reinventing it.

**Why character-based token estimation instead of tiktoken?** tiktoken requires a WASM binary and adds ~4MB. Our character-based approach is ±15% accurate, runs in microseconds, and has zero dependencies. For context window management (not billing), this is the right tradeoff.

**Why confirm destructive actions individually rather than upfront?** Each tool call needs its own confirmation because the model might call 3 tools in one batch — approving one doesn't mean approving all. Sequential confirmation with per-tool summaries gives the user fine-grained control.

**Why split tools into separate files?** Each tool is a self-contained module exporting `definition` + `execute(args)`. Adding a tool means creating one file and adding one line to the registry. Testing tools in isolation is trivial. The alternative (one monolithic tools file) would be unmaintainable past ~5 tools.

**Why not use a framework like LangChain?** LangChain adds layers of abstraction that make debugging harder. Our agent loop is ~60 lines. The tool registry is ~10 lines. Understanding the entire codebase takes an hour, not a week.

## Project Detection

On startup, `src/project.js` scans the workspace and detects:
- **Project type**: Node.js, Python, Go, Rust
- **Language**: JavaScript (CJS/ESM), TypeScript
- **Package manager**: npm, yarn, pnpm
- **Framework**: React, Next.js, Vue, Express, Fastify, NestJS
- **Test framework**: vitest, jest, mocha, pytest, tox, go test, cargo test
- **Lint tools**: eslint, prettier, tsc, ruff, flake8
- **Git**: whether the project is a git repository
- **Entry file**: index.js, main.ts, etc.

This context is injected into the system prompt so the agent knows what kind of project it's working in from the first message.
