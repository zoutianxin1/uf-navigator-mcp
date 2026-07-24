/**
 * Generic per-model configuration file I/O.
 *
 * Each model that has been configured has its own JSON file at
 * `{configDir}/model_configs/{safeId}.json`. Files are namespaced into
 * top-level sections (e.g. `thinking`), so future per-model defaults for
 * other dimensions (vision, tool-use, routing, ...) can add sibling
 * sections without schema migration.
 *
 * This module is deliberately free of any thinking-specific logic. The
 * thinking section's meaning (effort levels, vocabulary, request-body
 * field) lives in `thinking.ts`. Callers in `thinking.ts` use
 * `updateThinkingSection` to do read-merge-write updates that preserve
 * any unknown sibling sections.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./fileUtils.js";
import { getConfigDir } from "./paths.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ThinkingSection {
  default_effort: string;
  allowed_efforts: string[];
  effort_field: "reasoning_effort" | "output_config.effort" | null;
}

export interface ModelConfigFile {
  model_id: string;
  updated_at: string;
  thinking?: ThinkingSection;
  // Forward-compatible: unknown sibling sections are preserved.
  [extraSection: string]: unknown;
}

// ── Paths (resolved lazily so test overrides take effect post-import) ─────────

function modelConfigsDir(): string {
  return join(getConfigDir(), "model_configs");
}

/** Safe filename derived from a model id. Lowercased; non-`[a-z0-9._-]` → `_`. */
function safeId(modelId: string): string {
  return modelId.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

function modelConfigPath(modelId: string): string {
  return join(modelConfigsDir(), `${safeId(modelId)}.json`);
}

function ensureDir(): void {
  mkdirSync(modelConfigsDir(), { recursive: true });
}

// ── Shape validation ──────────────────────────────────────────────────────────

function isValidThinkingSection(value: unknown): value is ThinkingSection {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  if (typeof t.default_effort !== "string") return false;
  if (!Array.isArray(t.allowed_efforts)) return false;
  if (
    t.effort_field !== null &&
    t.effort_field !== "reasoning_effort" &&
    t.effort_field !== "output_config.effort"
  ) {
    return false;
  }
  return true;
}

function isValidConfigShape(value: unknown): value is ModelConfigFile {
  if (typeof value !== "object" || value === null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.model_id !== "string" || o.model_id.length === 0) return false;
  if (typeof o.updated_at !== "string") return false;
  if (o.thinking !== undefined && !isValidThinkingSection(o.thinking)) {
    return false;
  }
  // Unknown sibling keys are allowed (forward-compat).
  return true;
}

// ── I/O ───────────────────────────────────────────────────────────────────────

/** Read a model's config file. Returns null on missing, malformed, or schema-invalid files — never throws. */
export function readModelConfig(modelId: string): ModelConfigFile | null {
  const p = modelConfigPath(modelId);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8")) as unknown;
    if (!isValidConfigShape(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Atomic write. Always re-stamps `updated_at`. Canonicalises `model_id` to lowercase. */
export function writeModelConfig(file: ModelConfigFile): void {
  ensureDir();
  const stamped: ModelConfigFile = {
    ...file,
    model_id: file.model_id.toLowerCase(),
    updated_at: new Date().toISOString(),
  };
  atomicWriteFileSync(
    modelConfigPath(stamped.model_id),
    JSON.stringify(stamped, null, 2),
  );
}

/** Delete the whole file for this model. Returns false if the file did not exist. */
export function deleteModelConfig(modelId: string): boolean {
  const p = modelConfigPath(modelId);
  if (!existsSync(p)) return false;
  unlinkSync(p);
  return true;
}

/** Scan the directory. Invalid/corrupt files are skipped and counted. */
export function listModelConfigs(): {
  configs: ModelConfigFile[];
  skipped_unreadable: number;
} {
  const dir = modelConfigsDir();
  if (!existsSync(dir)) return { configs: [], skipped_unreadable: 0 };
  const configs: ModelConfigFile[] = [];
  let skipped = 0;
  for (const fname of readdirSync(dir)) {
    if (!fname.endsWith(".json")) continue;
    const full = join(dir, fname);
    try {
      const parsed = JSON.parse(readFileSync(full, "utf8")) as unknown;
      if (isValidConfigShape(parsed)) {
        configs.push(parsed);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }
  return { configs, skipped_unreadable: skipped };
}

// ── Section helpers ───────────────────────────────────────────────────────────

/** Returns true if the file contains any user-facing section (anything except `model_id` / `updated_at`). */
function hasAnySection(file: ModelConfigFile): boolean {
  for (const key of Object.keys(file)) {
    if (key === "model_id" || key === "updated_at") continue;
    if (file[key] !== undefined) return true;
  }
  return false;
}

/**
 * Read-merge-write update of the `.thinking` section.
 *
 * - `section` non-null → sets/overwrites the thinking section; preserves all
 *   other sibling sections untouched.
 * - `section` null → removes the thinking section. If no other sections
 *   remain, the whole file is deleted (current common case). If other
 *   sections exist, the file is rewritten without the thinking key.
 *
 * Returns the new file contents, or null if the file was deleted.
 */
export function updateThinkingSection(
  modelId: string,
  section: ThinkingSection | null,
): ModelConfigFile | null {
  const existing = readModelConfig(modelId);
  const base: ModelConfigFile = existing ?? {
    model_id: modelId.toLowerCase(),
    updated_at: new Date().toISOString(),
  };
  const merged: ModelConfigFile = { ...base };
  if (section === null) {
    delete merged.thinking;
  } else {
    merged.thinking = section;
  }

  if (!hasAnySection(merged)) {
    deleteModelConfig(modelId);
    return null;
  }

  writeModelConfig(merged);
  // Return the merged object with a fresh updated_at for callers that want to report it.
  return { ...merged, updated_at: new Date().toISOString() };
}
