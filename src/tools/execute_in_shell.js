import { exec } from "node:child_process";
import { resolveSafePath, validateCommand } from "../sandbox.js";

// Extract the base command (first word) from a shell command string.
// e.g., "ls -la | grep foo" → "ls", "ENV=val cmd" → "cmd"
function extractBaseCommand(cmdStr) {
  const trimmed = cmdStr.trim();
  // Strip leading variable assignments (KEY=value or KEY="value")
  const stripped = trimmed.replace(/^[A-Za-z_]\w*=("[^"]*"|'[^']*'|\S+)\s+/, "");
  const firstWord = stripped.split(/\s/)[0];
  return firstWord || "";
}

export const definition = {
  type: "function",
  function: {
    name: "execute_in_shell",
    description: "Execute a command string using the system shell. Supports pipes, redirects, and other shell features. WARNING: Be careful with user input to avoid injection. Prefer execute_command when possible.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command string to execute (e.g., 'ls -la | grep foo > output.txt' on Unix, or 'dir | findstr foo' on Windows).",
        },
        timeout: {
          type: "integer",
          description: "Optional timeout in milliseconds (default: 30000).",
        },
        cwd: {
          type: "string",
          description: "Optional working directory (must be within workspace).",
        },
      },
      required: ["command"],
    },
  },
};

// Blocked patterns for shell commands (in addition to the general sandbox rules)
const SHELL_BLOCKED_PATTERNS = [
  // Fork bombs
  /:\(\)\s*\{/, /fork\s*bomb/i,
  // Crypto mining downloads
  /xmrig/i, /minerd/i,
  // Data destruction (Unix)
  /rm\s+-rf\s+\//, /dd\s+if=\/dev\/zero/i, /mkfs/i, /fdisk/i, /mkswap/i,
  // Data destruction (Windows)
  /format\s+\w:\s*\/fs/i, /diskpart/i, /del\s+\/f\s+\/s\s+\/q/i, /rd\s+\/s\s+\/q\s+c:\\/i,
  // Privilege escalation
  /sudo\s/, /su\s/, /chown\s/, /passwd/i,
  // Privilege escalation (Windows)
  /runas\s/, /net\s+(user|localgroup)\s/, /wmic\s+useraccount/i,
  // Network scanning
  /nmap/i, /masscan/i,
  // Reverse shell patterns
  /bash\s+-i\s*[>&]/, /\/dev\/tcp\//, /\/dev\/udp\//,
  /exec\s+\/bin\/(ba)?sh/i,
  // Write to system directories
  />\s*\/etc\//, />\s*\/usr\//, />\s*\/boot\//, />\s*\/dev\//,
  // Write to Windows system directories
  />\s*[A-Za-z]:\\[Ww][Ii][Nn][Dd][Oo][Ww][Ss]\\/,
  // Download and execute
  /curl.*\|.*(sh|bash)/i, /wget.*\|.*(sh|bash)/i,
  // Remove git history
  /rm\s+-rf\s+\.git/i,
];

export async function execute(args) {
  const { command, timeout = 30000, cwd } = args;

  // Validate CWD
  let safeCwd = undefined;
  if (cwd) {
    try {
      safeCwd = resolveSafePath(cwd);
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  // Validate base command against allowlist
  const baseCmd = extractBaseCommand(command);
  if (baseCmd) {
    try {
      validateCommand(baseCmd, []);
    } catch (err) {
      return `Blocked: ${err.message}`;
    }
  }

  // Check blocked patterns
  for (const pattern of SHELL_BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return `Blocked: Command matched dangerous pattern "${pattern}".`;
    }
  }

  const safeTimeout = Math.min(Math.max(timeout, 1000), 120000);

  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: safeCwd,
      timeout: safeTimeout,
      maxBuffer: 1024 * 1024, // 1MB
      windowsHide: true,
    }, (error, stdout, stderr) => {
      let output = error
        ? `Exit code: ${error.code || 1}\n`
        : "Exit code: 0\n";

      if (stdout) {
        const maxLen = 5000;
        const out = stdout.length > maxLen
          ? stdout.slice(0, maxLen) + `\n... (truncated, ${stdout.length} chars total)`
          : stdout;
        output += `\nSTDOUT:\n${out}`;
      }

      if (stderr) {
        const maxStderrLen = 2000;
        const err = stderr.length > maxStderrLen
          ? stderr.slice(0, maxStderrLen) + `\n... (stderr truncated, ${stderr.length} chars total)`
          : stderr;
        output += `\nSTDERR:\n${err}`;
      }

      resolve(output);
    });
  });
}
