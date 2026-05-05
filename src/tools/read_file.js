import { readFile, stat } from "node:fs/promises";
import { resolveSafePath } from "../sandbox.js";

export const definition = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the contents of a file. Returns file content with line numbers (like cat -n).",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path to read. Can be relative or absolute (must be within workspace).",
        },
        offset: {
          type: "integer",
          description: "Optional. Line number to start reading from.",
        },
        limit: {
          type: "integer",
          description: "Optional. Maximum number of lines to read.",
        },
      },
      required: ["path"],
    },
  },
};

export async function execute(args) {
  let safePath;
  try {
    safePath = resolveSafePath(args.path);
  } catch (err) {
    return `Error: ${err.message}`;
  }

  // Check if the path is a directory
  let stats;
  try {
    stats = await stat(safePath);
  } catch (err) {
    return `Error: cannot access path "${args.path}": ${err.message}`;
  }

  if (stats.isDirectory()) {
    return `Error: "${args.path}" is a directory, not a file. Use list_directory to see its contents.`;
  }

  const content = await readFile(safePath, "utf-8");
  const lines = content.split("\n");
  let start = args.offset || 1;
  let end = args.limit ? start + args.limit - 1 : lines.length;
  const selected = lines.slice(start - 1, end);
  const numbered = selected
    .map((line, i) => `${String(start + i).padStart(6, " ")}\t${line}`)
    .join("\n");
  const summary = end < lines.length
    ? `(lines ${start}-${end}, total ${lines.length} lines)\n`
    : `(total ${lines.length} lines)\n`;
  return summary + numbered;
}
