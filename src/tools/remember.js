import { saveMemory, deleteMemory, getMemory, loadMemories } from "../memory.js";

export const definition = {
  type: "function",
  function: {
    name: "remember",
    description: "Store or recall persistent information that should survive across sessions. Use this to remember user preferences, project conventions, important decisions, or anything the user asks you to remember. Actions: 'save' (store a key-value fact), 'recall' (get a specific fact), 'list' (show all stored facts), 'delete' (remove a fact). This is your long-term memory.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["save", "recall", "list", "delete"],
          description: "The memory operation.",
        },
        key: {
          type: "string",
          description: "For save/recall/delete: the memory key (e.g., 'preferred_indentation', 'project_conventions').",
        },
        value: {
          type: "string",
          description: "For save: the value to store.",
        },
      },
      required: ["action"],
    },
  },
};

export async function execute(args) {
  const { action, key, value } = args;

  switch (action) {
    case "save": {
      if (!key || !value) return "Error: both 'key' and 'value' are required for save.";
      saveMemory(key, value);
      return `Saved: "${key}" = "${value}"`;
    }

    case "recall": {
      if (!key) return "Error: 'key' is required for recall.";
      const val = getMemory(key);
      return val !== null
        ? `"${key}": ${val}`
        : `No memory found for key "${key}".`;
    }

    case "list": {
      const all = loadMemories();
      if (all.length === 0) return "No memories stored yet.";
      return all
        .map(m => `- ${m.key}: ${m.value} (${m.updatedAt})`)
        .join("\n");
    }

    case "delete": {
      if (!key) return "Error: 'key' is required for delete.";
      const deleted = deleteMemory(key);
      return deleted ? `Deleted memory "${key}".` : `No memory found for key "${key}".`;
    }

    default:
      return `Unknown action: ${action}`;
  }
}
