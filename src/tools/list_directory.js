import { readdir, stat } from "node:fs/promises";
import { resolveSafePath } from "../sandbox.js";

export const definition = {
  type: "function",
  function: {
    name: "list_directory",
    description: "List files and directories in a given path. Returns an array of entries with name, type (file/directory), and size in bytes.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The directory path to list. Can be relative or absolute (must be within workspace).",
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

  const entries = await readdir(safePath, { withFileTypes: true });
  const result = await Promise.all(
    entries.map(async (entry) => {
      let size = null;
      if (entry.isFile()) {
        try {
          const s = await stat(resolveSafePath(entry.name, safePath));
          size = s.size;
        } catch {
          size = null;
        }
      }
      return {
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
        size,
      };
    })
  );
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return JSON.stringify(result, null, 2);
}
