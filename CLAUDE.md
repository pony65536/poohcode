# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Launch the interactive CLI agent
node index.js      # Same as above
```

No tests, lint, or build steps exist yet.

## Architecture

The project is a Node.js (ESM) coding agent CLI. It sends user input to DeepSeek's API (OpenAI-compatible), lets the model decide which tools to call, executes them, and feeds results back in a loop until the model produces a final text answer.

### Core modules

- **`index.js`** — readline CLI. Tracks `conversationHistory`, passes it to `runAgent`, and saves the returned messages for multi-turn context.
- **`src/agent.js`** — the agent loop. Builds a message list (system prompt + history + user message), calls `chat()`, and in a `while(true)` loop: if the response has `tool_calls`, executes each one and pushes `tool`-role messages back into the list; otherwise returns the final text answer. The system prompt is built dynamically from `getSandboxInfo()`, with platform-specific hints for Windows vs Unix.
- **`src/llm.js`** — wraps OpenAI SDK, configured with `DEEPSEEK_BASE_URL`/`DEEPSEEK_API_KEY`. The `chat()` function sends messages + optional tools and returns the response message. Also logs every request/response to `logs/llm-YYYY-MM-DD.log` (controlled by `POOHCODE_LOG` env var).
- **`src/sandbox.js`** — path sandboxing and command execution isolation:
  - `resolveSafePath(inputPath)` — resolves paths within the workspace, throws `SandboxError` if they escape. All file-operation tools use this.
  - `executeSandboxedCommand(command, args)` — runs a command via `execFile` (no shell), validates against ALLOWED_COMMANDS list (platform-aware: Windows vs Unix), strips sensitive env vars.
  - `executeDockerCommand(command, args)` — optional Docker-level isolation (`--network none`, `--read-only`, `--cap-drop ALL`), opt-in via `POOHCODE_DOCKER_SANDBOX=true`.
  - `getSandboxInfo()` — returns workspace path, allowed commands, platform; consumed by agent.js for the system prompt.

### Tools (`src/tools/`)

Each file exports `definition` (OpenAI function-calling format) and `execute(args)`. The registry at `src/tools/index.js` imports all tools, builds the `toolDefinitions` array and the `executorMap` lookup.

| Tool | File | Description |
|------|------|-------------|
| `list_directory` | `list_directory.js` | List dir contents with name/type/size |
| `read_file` | `read_file.js` | Read file with line numbers, offset/limit support |
| `write_file` | `write_file.js` | Write file, auto-creates parent dirs |
| `edit_file` | `edit_file.js` | Edit file via targeted text replacement (exact match or regex), with replaceAll support |
| `web_search` | `web_search.js` | Tavily search, prepends current ISO timestamp to query |
| `execute_command` | `execute_command.js` | Run a command via `execFile` (no shell, safe). On Windows, use for standalone executables only (node, git, python). |
| `execute_in_shell` | `execute_in_shell.js` | Run a command string via shell (pipes/redirects). On Windows, use for cmd.exe built-in commands (type, dir, copy). Extra blocklist with Windows patterns. |
| `search_code` | `search_code.js` | Search codebase with regex patterns, supports glob file filters |

### Platform adaptation

- **`src/sandbox.js`**: `ALLOWED_COMMANDS` is split into `UNIX_COMMANDS` and `WINDOWS_COMMANDS` arrays. On Windows, commands like `type`, `dir`, `findstr`, `powershell` are allowed; Unix-specific commands like `ls`, `cat`, `sudo` are excluded.
- **`execute_in_shell`**: Extra Windows blocklist patterns for `format`, `diskpart`, `runas`, `net user`, `net localgroup`, writing to `C:\Windows\`.
- **System prompt**: Dynamically includes platform-specific guidance (e.g., "use execute_in_shell for cmd.exe built-in commands on Windows").

### Key patterns

- **Adding a tool**: create `src/tools/new_tool.js` exporting `definition` + `execute(args)`, then add it to the `tools` array in `src/tools/index.js`.
- **Sandbox**: all file tools use `resolveSafePath()` before any fs operation. Command tools validate through the sandbox module.
- **Logging**: set `POOHCODE_LOG=false` to disable. Logs write to `logs/` by default; override with `POOHCODE_LOG_DIR`.
