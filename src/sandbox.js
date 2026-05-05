/**
 * Sandbox module for PoohCode.
 * Provides path sandboxing and command execution isolation.
 *
 * Architecture:
 * 1. Path Sandbox: All file operations are restricted to a configurable workspace directory.
 * 2. Command Execution: Shell commands run in a subprocess with restricted scope.
 * 3. Optional Docker Sandbox: For full container-level isolation (opt-in).
 */

import { resolve, normalize, relative } from "node:path";
import { execFile, spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { platform, homedir } from "node:os";

// ─── Configuration ───────────────────────────────────────────────────────────

const DEFAULT_WORKSPACE = process.env.POOHCODE_WORKSPACE || process.cwd();
const CURRENT_PLATFORM = platform();

// Platform-specific command sets
const UNIX_COMMANDS = [
  // File operations
  "ls", "cat", "head", "tail", "wc", "find", "grep", "sort", "uniq", "diff",
  "cp", "mv", "rm", "mkdir", "touch", "chmod", "ln",
  // Development tools
  "node", "npm", "npx", "yarn", "pnpm",
  "git", "curl", "wget",
  "python", "python3", "pip", "pip3",
  "go", "rustc", "cargo",
  "make", "cmake",
  "echo", "printf", "tee",
  "tar", "gzip", "gunzip", "zip", "unzip",
  "jq", "sed", "awk",
];

const WINDOWS_COMMANDS = [
  // Shell executables
  "cmd", "powershell", "pwsh",
  // Standard Windows executables (can run via execFile)
  "findstr", "sort", "where", "fc", "xcopy", "robocopy",
  "attrib", "icacls", "takeown",
  // Development tools
  "node", "npm", "npx", "yarn", "pnpm",
  "git", "curl", "wget", "tar",
  "python", "python3", "pip", "pip3",
  "go", "rustc", "cargo",
  "cmake", "mingw32-make",
  "echo", "printf",
  "jq", "sed", "awk", // via Git Bash or WSL
  "zip", "unzip", "gzip", "gunzip",
  "chkdsk", "ver", "systeminfo",
  // PowerShell cmdlets won't work via execFile, use powershell -Command
];

function getAllowedCommands() {
  if (CURRENT_PLATFORM === "win32") {
    return [...WINDOWS_COMMANDS];
  }
  return [...UNIX_COMMANDS];
}

const ALLOWED_COMMANDS = getAllowedCommands();

const BLOCKED_PATTERNS = [
  // Network scanning / disruptive
  /nmap/i, /masscan/i,
  // Cryptomining
  /minerd/i, /xmrig/i, /cryptonight/i,
  // Fork bombs and destructive
  /:\(\)\s*\{/, /fork\s*bomb/i,
  // System modification
  /sudo\s+rm\s+-rf\s+\//, /dd\s+if=/, /mkfs/i, /fdisk/i,
];

// ─── Environment cleanup ──────────────────────────────────────────────────────

const SENSITIVE_ENV_KEYS = [
  "DEEPSEEK_API_KEY",
  "TAVILY_API_KEY",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_KEY",
  "ANTHROPIC_API_KEY",
  "TELEGRAM_BOT_TOKEN",
];

/**
 * Return a copy of process.env with sensitive keys stripped.
 * Use this before spawning child processes to prevent API key leakage.
 */
export function cleanEnv() {
  const env = { ...process.env };
  for (const key of SENSITIVE_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

// ─── Path Sandbox ────────────────────────────────────────────────────────────

/**
 * Resolve a path safely within the workspace.
 * Throws if the resolved path escapes the workspace.
 */
export function resolveSafePath(inputPath, workspace = DEFAULT_WORKSPACE) {
  const resolvedWorkspace = resolve(workspace);
  const resolvedPath = resolve(resolvedWorkspace, inputPath);
  const normalizedPath = normalize(resolvedPath);

  // Case-insensitive check on Windows (filesystem is case-insensitive)
  const isWithin = CURRENT_PLATFORM === "win32"
    ? normalizedPath.toLowerCase().startsWith(resolvedWorkspace.toLowerCase())
    : normalizedPath.startsWith(resolvedWorkspace);

  if (!isWithin) {
    throw new SandboxError(
      `Path "${inputPath}" resolves to "${normalizedPath}" which is outside the workspace "${resolvedWorkspace}"`
    );
  }

  return normalizedPath;
}

/**
 * Verify that a path exists inside the sandbox.
 */
export async function ensureInSandbox(inputPath, workspace = DEFAULT_WORKSPACE) {
  const safePath = resolveSafePath(inputPath, workspace);
  try {
    await access(safePath, constants.F_OK);
  } catch {
    // Path doesn't exist yet but is safe (e.g., for write operations)
  }
  return safePath;
}

// ─── Command Sandbox ─────────────────────────────────────────────────────────

/**
 * Validate a command against the allowlist and blocklist.
 */
export function validateCommand(command, args = []) {
  const cmd = command.toLowerCase();

  // Check allowlist
  if (!ALLOWED_COMMANDS.includes(cmd)) {
    throw new SandboxError(
      `Command "${command}" is not in the allowed list. ` +
      `Allowed commands: ${ALLOWED_COMMANDS.join(", ")}`
    );
  }

  // Check blocklist patterns against full command string
  const fullCmd = `${command} ${args.join(" ")}`;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullCmd)) {
      throw new SandboxError(
        `Command matches blocked pattern: ${pattern}`
      );
    }
  }

  return true;
}

/**
 * Execute a sandboxed command.
 * Uses execFile to avoid shell injection (no shell by default).
 */
export function executeSandboxedCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const {
      timeout = 30000,        // 30 second default timeout
      maxBuffer = 1024 * 1024, // 1MB output limit
      cwd = DEFAULT_WORKSPACE,
      env = cleanEnv(),
    } = options;

    // Validate command
    try {
      validateCommand(command, args);
    } catch (err) {
      return reject(err);
    }

    const child = execFile(command, args, {
      cwd: resolve(cwd),
      timeout,
      maxBuffer,
      env,
      shell: false,  // IMPORTANT: no shell to prevent injection
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        // Timeout errors
        if (error.killed || error.code === 'ETIMEOUT') {
          return reject(new SandboxError(
            `Command "${command}" timed out after ${timeout}ms`
          ));
        }
        // Return stderr as part of the result instead of throwing
        return resolve({
          exitCode: error.code || 1,
          stdout: stdout || "",
          stderr: stderr || error.message,
        });
      }
      resolve({
        exitCode: 0,
        stdout: stdout || "",
        stderr: stderr || "",
      });
    });
  });
}

// ─── Docker Sandbox (Optional) ───────────────────────────────────────────────

/**
 * Run a command inside a Docker container for full isolation.
 * Requires Docker to be installed and the user to opt in via config.
 */
export function executeDockerCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const {
      timeout = 60000,
      cwd = DEFAULT_WORKSPACE,
      image = "node:20-alpine",
      containerName = `poohcode-sandbox-${Date.now()}`,
    } = options;

    const dockerArgs = [
      "run",
      "--rm",
      "--name", containerName,
      "--network", "none",             // No network access
      "--read-only",                    // Read-only filesystem
      "--cap-drop", "ALL",             // Drop all capabilities
      "--security-opt", "no-new-privileges:true",
      "-v", `${resolve(cwd)}:/workspace:ro`,  // Mount workspace read-only
      "-w", "/workspace",
      image,
      command,
      ...args,
    ];

    const child = spawn("docker", dockerArgs, {
      timeout,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });

    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode || 0, stdout, stderr });
    });

    child.on("error", (err) => {
      if (err.message.includes("ENOENT")) {
        reject(new SandboxError(
          "Docker is not installed or not running. Please install Docker or disable docker sandbox."
        ));
      } else {
        reject(err);
      }
    });
  });
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class SandboxError extends Error {
  constructor(message) {
    super(`[Sandbox] ${message}`);
    this.name = "SandboxError";
  }
}

// ─── Workspace Info ──────────────────────────────────────────────────────────

export function getSandboxInfo() {
  return {
    workspace: resolve(DEFAULT_WORKSPACE),
    allowedCommands: [...ALLOWED_COMMANDS],
    blockedPatterns: BLOCKED_PATTERNS.map(p => p.toString()),
    useDocker: process.env.POOHCODE_DOCKER_SANDBOX === "true",
    platform: CURRENT_PLATFORM,
  };
}
