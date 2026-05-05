import { spawn } from "node:child_process";
import { resolveSafePath, executeSandboxedCommand, executeDockerCommand, SandboxError, validateCommand, cleanEnv } from "../sandbox.js";
import { get } from "../config.js";

export const definition = {
  type: "function",
  function: {
    name: "execute_command",
    description: "Execute a command in the sandboxed environment. No shell features. Set 'interactive: true' to pass stdin through for commands that need user input (npm init, ssh, etc.). Prefer execute_in_shell for pipes/redirects.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The command to execute (must be in the allowed list).",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments to pass to the command.",
        },
        timeout: {
          type: "integer",
          description: "Optional timeout in milliseconds (default: 30000).",
        },
        cwd: {
          type: "string",
          description: "Optional working directory (must be within workspace).",
        },
        interactive: {
          type: "boolean",
          description: "Set to true for commands that need interactive terminal input (e.g. npm init, python REPL). Uses stdin/stdout inheritance.",
        },
      },
      required: ["command"],
    },
  },
};

export async function execute(args) {
  const defaultTimeout = get("tools.executeCommand.timeout", 30000);
  const { command, args: cmdArgs = [], timeout = defaultTimeout, cwd, interactive = false } = args;

  // Clamp timeout
  const maxTimeout = get("tools.executeCommand.maxTimeout", 120000);
  const safeTimeout = Math.min(Math.max(timeout, 1000), maxTimeout);

  // Validate CWD if provided
  let safeCwd = undefined;
  if (cwd) {
    try {
      safeCwd = resolveSafePath(cwd);
    } catch (err) {
      return `Error: ${err.message}`;
    }
  }

  // Validate command
  try {
    validateCommand(command, cmdArgs);
  } catch (err) {
    return `Blocked: ${err.message}`;
  }

  // ── Interactive mode: spawn with inherited stdio ────────────────────
  if (interactive) {
    return new Promise((resolve) => {
      process.stdout.write(`  [interactive] ${command} ${cmdArgs.join(" ")}\n`);

      const child = spawn(command, cmdArgs, {
        cwd: safeCwd,
        stdio: "inherit",
        timeout: safeTimeout,
        windowsHide: true,
        env: cleanEnv(),
      });

      child.on("close", (code) => {
        resolve(`Interactive command "${command}" exited with code ${code}.`);
      });

      child.on("error", (err) => {
        resolve(`Error: ${err.message}`);
      });
    });
  }

  // ── Non-interactive: execFile ─────────────────────────────────────
  try {
    const useDocker = process.env.POOHCODE_DOCKER_SANDBOX === "true";

    let result;
    if (useDocker) {
      result = await executeDockerCommand(command, cmdArgs, {
        timeout: safeTimeout,
        cwd: safeCwd,
      });
    } else {
      result = await executeSandboxedCommand(command, cmdArgs, {
        timeout: safeTimeout,
        cwd: safeCwd,
      });
    }

    let output = `Exit code: ${result.exitCode}\n`;

    if (result.stdout) {
      // Truncate output if too long
      const maxOutputLength = get("tools.executeCommand.maxOutputLength", 5000);
      const stdout = result.stdout.length > maxOutputLength
        ? result.stdout.slice(0, maxOutputLength) + `\n... (truncated, ${result.stdout.length} chars total)`
        : result.stdout;
      output += `\nSTDOUT:\n${stdout}`;
    }

    if (result.stderr) {
      const maxStderrLen = 2000;
      const err = result.stderr.length > maxStderrLen
        ? result.stderr.slice(0, maxStderrLen) + `\n... (stderr truncated, ${result.stderr.length} chars total)`
        : result.stderr;
      output += `\nSTDERR:\n${err}`;
    }

    return output;
  } catch (err) {
    if (err instanceof SandboxError) {
      return `Sandbox Error: ${err.message}`;
    }
    return `Error executing command: ${err.message}`;
  }
}
