import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveSafePath } from "../sandbox.js";
import { unifiedDiff } from "../diff.js";

export const definition = {
  type: "function",
  function: {
    name: "write_file",
    description: "Write content to a file. Creates parent directories if needed. Overwrites existing files.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path to write to. Can be relative or absolute (must be within workspace).",
        },
        content: {
          type: "string",
          description: "The content to write to the file.",
        },
      },
      required: ["path", "content"],
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

  // Check if file already exists for diff
  let oldContent = null;
  try {
    oldContent = await readFile(safePath, "utf-8");
  } catch {
    // File doesn't exist, will be created
  }

  await mkdir(dirname(safePath), { recursive: true });
  await writeFile(safePath, args.content, "utf-8");

  if (oldContent !== null) {
    const diff = unifiedDiff(oldContent, args.content, args.path);
    return `Updated "${args.path}".\n\n${diff}`;
  }
  return `Created "${safePath}" (${args.content.length} chars).`;
}
