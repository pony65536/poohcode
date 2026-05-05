import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, extname, basename } from "node:path";
import { resolveSafePath } from "../sandbox.js";

export const definition = {
  type: "function",
  function: {
    name: "search_code",
    description: "Search for a text pattern (regex) in files within a directory tree. Returns matching lines with file path, line number, and line content. Essential for finding where symbols, functions, or patterns appear in the codebase.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "The regex pattern to search for. Example: 'function\\s+login' to find login function definitions.",
        },
        path: {
          type: "string",
          description: "The directory to search in. Defaults to the workspace root.",
        },
        glob: {
          type: "string",
          description: "Optional file pattern filter. Examples: '*.js', '*.{ts,tsx}', '**/*.py'. Supports brace expansion.",
        },
        maxResults: {
          type: "integer",
          description: "Maximum number of matching lines to return (default: 50).",
        },
      },
      required: ["pattern"],
    },
  },
};

// Convert a simple glob pattern to a regex for testing
function globToRegex(glob) {
  let p = glob.replace(/\./g, "\\.");
  p = p.replace(/\*\*/g, "<<<GLOBSTAR>>>");
  p = p.replace(/\*/g, "[^/]*");
  p = p.replace(/<<<GLOBSTAR>>>/g, ".*");
  // Handle brace expansion: {ts,tsx} -> (ts|tsx)
  p = p.replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(",").join("|")})`);
  return new RegExp(`^${p}$`);
}

// Recursively collect files matching the glob
async function collectFiles(dir, regex, baseDir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results; // skip unreadable directories
  }

  for (const entry of entries) {
    const entryName = entry.name;

    // Skip version control and package directories
    if (entryName === "node_modules" || entryName === ".git") {
      continue;
    }

    // Skip hidden directories (but NOT hidden files like .env, .gitignore)
    if (entry.isDirectory() && entryName.startsWith(".")) {
      continue;
    }

    const fullPath = resolve(dir, entryName);
    const relPath = relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      const sub = await collectFiles(fullPath, regex, baseDir);
      results.push(...sub);
    } else if (entry.isFile()) {
      if (regex.test(relPath)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

// Check if a file looks like a text file (not binary)
const MAX_FILE_SIZE = 500 * 1024;  // 500KB max per file
const MAX_FILES = 500;             // max files to search
const MAX_TIME_PER_FILE = 200;     // max ms spent on regex per file

// Detect potentially dangerous regex patterns (nested quantifiers, etc.)
const DANGEROUS_REGEX = /\([^)]*[*+{][^)]*\)[*+{]/;

const TEXT_EXTENSIONS = new Set([
  ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi", ".pyx",
  ".go", ".rs", ".java", ".kt", ".scala",
  ".c", ".cpp", ".h", ".hpp", ".cc",
  ".rb", ".php", ".swift",
  ".html", ".css", ".scss", ".less",
  ".json", ".yaml", ".yml", ".toml", ".xml",
  ".md", ".txt", ".csv", ".sql",
  ".sh", ".bash", ".zsh", ".bat", ".ps1",
  ".vue", ".svelte", ".astro",
  ".env", ".gitignore", ".dockerignore",
  "Dockerfile", "Makefile",
]);

function isTextFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  const base = basename(filePath);
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(base);
}

export async function execute(args) {
  const { pattern, path: dirPath, glob, maxResults = 50 } = args;

  let regex;
  try {
    regex = new RegExp(pattern, "g");
  } catch {
    return `Error: invalid regex pattern "${pattern}".`;
  }

  // Check for potentially dangerous regex patterns (ReDoS)
  if (DANGEROUS_REGEX.test(pattern)) {
    return `Error: the regex pattern "${pattern}" contains potentially unsafe nested quantifiers that could cause performance issues. Please simplify the pattern.`;
  }

  let searchDir;
  try {
    searchDir = resolveSafePath(dirPath || ".");
  } catch (err) {
    return `Error: ${err.message}`;
  }

  let globRegex;
  if (glob) {
    try {
      globRegex = globToRegex(glob);
    } catch {
      return `Error: invalid glob pattern "${glob}".`;
    }
  } else {
    globRegex = /.*/;
  }

  // Collect files
  let files;
  try {
    files = await collectFiles(searchDir, globRegex, searchDir);
  } catch (err) {
    return `Error listing files: ${err.message}`;
  }

  if (files.length > MAX_FILES) {
    return `Error: too many files matched (${files.length} > ${MAX_FILES} max). Narrow your search with a more specific 'glob' pattern or 'path'.`;
  }

  // Search through files
  const results = [];
  let searchedCount = 0;
  for (const filePath of files) {
    if (!isTextFile(filePath)) continue;
    if (results.length >= maxResults) break;

    // Check file size before reading
    let fileSize;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch {
      continue;
    }
    if (fileSize > MAX_FILE_SIZE) continue;
    searchedCount++;

    let content;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    const fileStartTime = Date.now();
    for (let i = 0; i < lines.length; i++) {
      if (results.length >= maxResults) break;

      // Per-file regex timeout
      if (Date.now() - fileStartTime > MAX_TIME_PER_FILE) break;

      regex.lastIndex = 0;
      try {
        if (regex.test(lines[i])) {
          const relPath = relative(searchDir, filePath);
          results.push({
            file: relPath,
            line: i + 1,
            content: lines[i].trim(),
          });
        }
      } catch {
        // Skip lines that cause regex errors
        continue;
      }
    }
  }

  if (results.length === 0) {
    return `No matches found for pattern "${pattern}"${glob ? ` with glob "${glob}"` : ""}.`;
  }

  const maxResultsReached = results.length >= maxResults ? ` (capped at ${maxResults})` : "";
  const header = `Found ${results.length} matches${maxResultsReached}:\n\n`;
  const body = results
    .map((r) => `${r.file}:${r.line}\t${r.content}`)
    .join("\n");
  return header + body;
}
