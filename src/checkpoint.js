import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const CHECKPOINT_DIR = resolve(process.cwd(), ".poohcode", "checkpoints");
const MAX_CHECKPOINTS = 20;

function ensureDir() {
  if (!existsSync(CHECKPOINT_DIR)) mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 120);
}

export function saveCheckpoint(messages, tag = "") {
  ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const label = tag ? `${ts}_${sanitize(tag)}` : ts;
  const file = resolve(CHECKPOINT_DIR, `${label}.json`);
  writeFileSync(file, JSON.stringify(messages, null, 2), "utf-8");

  // Prune old checkpoints
  const files = listCheckpointFiles();
  while (files.length > MAX_CHECKPOINTS) {
    try { unlinkSync(files.shift()); } catch { /* ignore */ }
  }
  return label;
}

function listCheckpointFiles() {
  try {
    return readdirSync(CHECKPOINT_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => resolve(CHECKPOINT_DIR, f))
      .sort();
  } catch {
    return [];
  }
}

export function listCheckpoints() {
  return listCheckpointFiles().map(f => {
    const name = f.replace(/\.json$/, "").split(/[/\\]/).pop();
    try {
      const data = JSON.parse(readFileSync(f, "utf-8"));
      const msgs = Array.isArray(data) ? data.length : 0;
      return { name, messages: msgs };
    } catch {
      return { name, messages: "corrupted" };
    }
  });
}

export function restoreCheckpoint(name) {
  const file = resolve(CHECKPOINT_DIR, `${name}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

export function getLatestCheckpoint() {
  const files = listCheckpointFiles();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  try {
    return JSON.parse(readFileSync(latest, "utf-8"));
  } catch {
    return null;
  }
}
