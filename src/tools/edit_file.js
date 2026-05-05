import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveSafePath } from "../sandbox.js";
import { unifiedDiff } from "../diff.js";

export const definition = {
  type: "function",
  function: {
    name: "edit_file",
    description: "Edit a file by replacing a specific text pattern with new content. Uses exact string replacement (not regex by default) to make surgical edits to existing files. Returns a summary of the edit. If multiple occurrences of the old text exist, only the first occurrence is replaced — use the 'replaceAll' parameter to replace all occurrences.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path to edit. Can be relative or absolute (must be within workspace).",
        },
        old: {
          type: "string",
          description: "The exact text to search for (case-sensitive). Will be replaced with 'new' text.",
        },
        new: {
          type: "string",
          description: "The replacement text.",
        },
        replaceAll: {
          type: "boolean",
          description: "If true, replace all occurrences of 'old' text. If false (default), only replace the first occurrence.",
        },
        useRegex: {
          type: "boolean",
          description: "If true, treat 'old' as a regular expression pattern (with 'g' flag automatically added when replaceAll is true). Use this for pattern-based replacements.",
        },
      },
      required: ["path", "old", "new"],
    },
  },
};

const DANGEROUS_REGEX = /(?:\([^)]*\+[^)]*\)[*+])|(?:\([^)]*[*+][^)]*\)[*+])|(?:\+\+)|(?:\*\*)|(?:\+[*+])|(?:\([^)]*\|[^)]*\)[*+])/;

export async function execute(args) {
  const { path, old: oldText, new: newText, replaceAll = false, useRegex = false } = args;

  let safePath;
  try {
    safePath = resolveSafePath(path);
  } catch (err) {
    return `Error: ${err.message}`;
  }

  let content;
  try {
    content = await readFile(safePath, "utf-8");
  } catch (err) {
    return `Error reading file "${path}": ${err.message}`;
  }

  let result;
  let count = 0;

  if (useRegex) {
    let pattern;
    try {
      const flags = replaceAll ? "g" : "";
      pattern = new RegExp(oldText, flags);
    } catch (err) {
      return `Error: invalid regex pattern "${oldText}": ${err.message}`;
    }

    // Check for potentially dangerous patterns
    if (DANGEROUS_REGEX.test(oldText)) {
      return `Error: the regex pattern "${oldText}" contains potentially unsafe nested quantifiers that could cause performance issues. Please simplify the pattern.`;
    }

    try {
      const matches = content.match(pattern);
      count = matches ? matches.length : 0;
      if (count === 0) {
        return `No matches found for regex "${oldText}" in "${path}". The file was not modified.`;
      }
      result = content.replace(pattern, newText);
    } catch (err) {
      return `Error applying regex "${oldText}": ${err.message}`;
    }
  } else {
    if (!content.includes(oldText)) {
      return `Text not found in "${path}". The file was not modified. Make sure the 'old' text matches exactly (including whitespace and indentation).`;
    }
    count = replaceAll
      ? content.split(oldText).length - 1
      : 1;
    result = replaceAll
      ? content.replaceAll(oldText, newText)
      : content.replace(oldText, newText);
  }

  try {
    await mkdir(dirname(safePath), { recursive: true });
    await writeFile(safePath, result, "utf-8");
  } catch (err) {
    return `Error writing file "${path}": ${err.message}`;
  }

  const occurrences = count === 1 ? "1 occurrence" : `${count} occurrences`;
  const diff = unifiedDiff(content, result, path);
  return `Edited "${path}": replaced ${occurrences}.\n\n${diff}`;
}
