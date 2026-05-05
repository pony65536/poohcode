import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const MEMORY_DIR = resolve(process.env.POOHCODE_MEMORY_DIR || process.cwd(), ".poohcode");
const MEMORY_FILE = resolve(MEMORY_DIR, "memory.json");

function ensureDir() {
  if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

/**
 * Load all stored memories. Returns an array of { key, value, updatedAt }.
 */
export function loadMemories() {
  try {
    if (existsSync(MEMORY_FILE)) {
      return JSON.parse(readFileSync(MEMORY_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Save or update a memory entry.
 */
export function saveMemory(key, value) {
  ensureDir();
  const memories = loadMemories();
  const existing = memories.find(m => m.key === key);
  if (existing) {
    existing.value = value;
    existing.updatedAt = new Date().toISOString();
  } else {
    memories.push({ key, value, updatedAt: new Date().toISOString() });
  }
  writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf-8");
}

/**
 * Delete a memory by key. Returns true if deleted.
 */
export function deleteMemory(key) {
  const memories = loadMemories();
  const idx = memories.findIndex(m => m.key === key);
  if (idx === -1) return false;
  memories.splice(idx, 1);
  ensureDir();
  writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf-8");
  return true;
}

/**
 * Get a single memory by key.
 */
export function getMemory(key) {
  const memories = loadMemories();
  const m = memories.find(m => m.key === key);
  return m ? m.value : null;
}

/**
 * Format memories for injection into system prompt.
 */
export function formatMemoriesForPrompt() {
  const memories = loadMemories();
  if (memories.length === 0) return "";
  return memories
    .map(m => `- ${m.key}: ${m.value}`)
    .join("\n");
}
