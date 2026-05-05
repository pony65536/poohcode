import { execFile } from "node:child_process";
import { resolveSafePath } from "../sandbox.js";

// Combined git tools: status, diff, log
export const definition = {
  type: "function",
  function: {
    name: "git",
    description: "Run git operations to understand repository state. Actions: 'status' (working tree status), 'diff' (show changes, optionally staged or for a specific file), 'log' (recent commit history), 'branch' (current branch info). Use this before and after making changes to verify what was modified.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "diff", "log", "branch"],
          description: "The git operation to perform.",
        },
        staged: {
          type: "boolean",
          description: "For 'diff': if true, show staged changes. Default: false (working tree changes).",
        },
        path: {
          type: "string",
          description: "For 'diff': limit to a specific file path.",
        },
        count: {
          type: "integer",
          description: "For 'log': number of recent commits to show (default: 5).",
        },
      },
      required: ["action"],
    },
  },
};

function runGit(args, cwd) {
  return new Promise((resolve) => {
    execFile("git", args, {
      cwd,
      timeout: 10000,
      maxBuffer: 500 * 1024,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        resolve(`Git error: ${stderr || error.message}`);
        return;
      }
      resolve(stdout || stderr || "(no output)");
    });
  });
}

export async function execute(args) {
  const { action, staged = false, path, count = 5 } = args;

  let workspace;
  try {
    workspace = resolveSafePath(".");
  } catch (err) {
    return `Error: ${err.message}`;
  }

  switch (action) {
    case "status":
      return await runGit(["status", "--short"], workspace);

    case "diff": {
      const diffArgs = ["diff"];
      if (staged) diffArgs.push("--staged");
      if (path) diffArgs.push("--", path);
      return await runGit(diffArgs, workspace);
    }

    case "log":
      return await runGit(
        ["log", "--oneline", `-${Math.min(count, 20)}`, "--no-pager"],
        workspace
      );

    case "branch":
      return await runGit(["branch", "--list", "--verbose"], workspace);

    default:
      return `Unknown git action: ${action}`;
  }
}
