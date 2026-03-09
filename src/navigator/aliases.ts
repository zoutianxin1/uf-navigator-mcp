import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./fileUtils.js";
import { getConfigDir } from "./paths.js";
import { modelExists } from "./modelsCache.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AliasMap = Record<string, string>;

export interface ResolveResult {
  resolvedModel: string;
  source: "alias" | "literal";
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const ALIASES_FILE = join(getConfigDir(), "aliases.json");

function ensureConfigDir(): void {
  mkdirSync(getConfigDir(), { recursive: true });
}

// ── I/O ───────────────────────────────────────────────────────────────────────

function readAliasFile(): AliasMap | null {
  if (!existsSync(ALIASES_FILE)) return null;
  try {
    return JSON.parse(readFileSync(ALIASES_FILE, "utf8")) as AliasMap;
  } catch {
    return null;
  }
}

function writeAliasFile(aliases: AliasMap): void {
  ensureConfigDir();
  atomicWriteFileSync(ALIASES_FILE, JSON.stringify(aliases, null, 2));
}

// ── Seeding ───────────────────────────────────────────────────────────────────

/** Create empty aliases file if none exists. No-op if file already present. */
export function seedDefaultAliases(): void {
  if (!existsSync(ALIASES_FILE)) {
    writeAliasFile({});
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Return all aliases. Returns empty object if file missing. */
export function getAliases(): AliasMap {
  return readAliasFile() ?? {};
}

export interface SetAliasResult {
  alias: string;
  model: string;
  warning?: string;
}

/**
 * Set (or overwrite) an alias → model mapping.
 * Warns if the model id is not in the current cache, but does not block.
 */
export async function setAlias(
  alias: string,
  model: string,
): Promise<SetAliasResult> {
  const aliases = readAliasFile() ?? {};
  aliases[alias] = model;
  writeAliasFile(aliases);

  let warning: string | undefined;
  const exists = await modelExists(model).catch(() => false);
  if (!exists) {
    warning = `Model "${model}" was not found in the current model cache. ` +
      `The alias was saved, but verify the model ID is correct.`;
  }

  return { alias, model, warning };
}

/**
 * Resolve an alias or literal model name.
 * Returns the resolved model id and whether it came from an alias lookup.
 */
export function resolveModel(modelOrAlias: string): ResolveResult {
  const aliases = readAliasFile() ?? {};
  if (Object.prototype.hasOwnProperty.call(aliases, modelOrAlias)) {
    return { resolvedModel: aliases[modelOrAlias], source: "alias" };
  }
  return { resolvedModel: modelOrAlias, source: "literal" };
}

/** Delete an alias. Returns false if alias did not exist. */
export function deleteAlias(alias: string): boolean {
  const aliases = readAliasFile() ?? {};
  if (!Object.prototype.hasOwnProperty.call(aliases, alias)) return false;
  delete aliases[alias];
  writeAliasFile(aliases);
  return true;
}
