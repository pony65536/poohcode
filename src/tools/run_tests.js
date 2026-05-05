import { execFile } from "node:child_process";
import { resolveSafePath, cleanEnv } from "../sandbox.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const definition = {
  type: "function",
  function: {
    name: "run_tests",
    description: "Run the project's test suite. Auto-detects the test runner based on project files (package.json scripts, pytest, go test, etc.). Use this after making code changes to verify they work correctly. If the specific test runner is known, use execute_command instead for more control.",
    parameters: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          description: "Optional test name or file pattern to filter which tests to run. Example: 'login' or 'src/auth.test.js'.",
        },
        timeout: {
          type: "integer",
          description: "Optional timeout in milliseconds (default: 60000).",
        },
      },
      required: [],
    },
  },
};

function detectTestRunner(workspace) {
  const root = resolve(workspace);

  // Node.js projects
  if (existsSync(resolve(root, "package.json"))) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(root, "package.json"), "utf-8")
      );
      const scripts = pkg.scripts || {};
      if (scripts.test) return { runner: "npm", args: ["run", "test"], base: scripts.test };
      if (scripts["test:unit"]) return { runner: "npm", args: ["run", "test:unit"], base: scripts["test:unit"] };
      // Check for specific test frameworks
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.vitest) return { runner: "npx", args: ["vitest", "run"], base: "vitest" };
      if (deps.jest) return { runner: "npx", args: ["jest"], base: "jest" };
      if (deps.mocha) return { runner: "npx", args: ["mocha"], base: "mocha" };
    } catch { /* ignore */ }
  }

  // Python projects
  if (existsSync(resolve(root, "pytest.ini")) ||
      existsSync(resolve(root, "pyproject.toml")) ||
      existsSync(resolve(root, "setup.cfg"))) {
    return { runner: "python", args: ["-m", "pytest"], base: "pytest" };
  }
  if (existsSync(resolve(root, "tox.ini"))) {
    return { runner: "python", args: ["-m", "tox"], base: "tox" };
  }

  // Go projects
  if (existsSync(resolve(root, "go.mod"))) {
    return { runner: "go", args: ["test", "./..."], base: "go test" };
  }

  // Rust projects
  if (existsSync(resolve(root, "Cargo.toml"))) {
    return { runner: "cargo", args: ["test"], base: "cargo test" };
  }

  return null;
}

function runCommand(command, args, cwd, timeout) {
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: cleanEnv(),
    }, (error, stdout, stderr) => {
      let output = "";
      if (error) {
        output += `Exit code: ${error.code || 1}\n`;
      } else {
        output += "Exit code: 0\n";
      }
      if (stdout) {
        const maxLen = 5000;
        output += stdout.length > maxLen
          ? `\nSTDOUT:\n${stdout.slice(0, maxLen)}\n... (truncated, ${stdout.length} total)`
          : `\nSTDOUT:\n${stdout}`;
      }
      if (stderr) {
        const maxLen = 2000;
        output += stderr.length > maxLen
          ? `\nSTDERR:\n${stderr.slice(0, maxLen)}\n... (truncated, ${stderr.length} total)`
          : `\nSTDERR:\n${stderr}`;
      }
      resolve(output);
    });
  });
}

export async function execute(args) {
  const { filter, timeout = 60000 } = args;

  let workspace;
  try {
    workspace = resolveSafePath(".");
  } catch (err) {
    return `Error: ${err.message}`;
  }

  const detected = detectTestRunner(workspace);

  if (!detected) {
    return "No test runner detected. Try running tests manually with execute_command (e.g., 'npm test', 'pytest', 'go test').";
  }

  const cmdArgs = [...detected.args];
  if (filter) {
    if (detected.base === "pytest") {
      cmdArgs.push("-k", filter);
    } else if (detected.base === "jest" || detected.base === "vitest") {
      cmdArgs.push("--", filter);
    } else if (detected.base === "go test") {
      cmdArgs[cmdArgs.length - 1] = filter;
    } else {
      cmdArgs.push("--", filter);
    }
  }

  try {
    const result = await runCommand(detected.runner, cmdArgs, workspace, timeout);
    return `Test runner: ${detected.runner} ${detected.args.join(" ")}\n\n${result}`;
  } catch (err) {
    return `Error running tests: ${err.message}`;
  }
}
