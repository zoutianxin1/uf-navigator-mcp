import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { navigatorJSON } from "./client.js";
import { atomicWriteFileSync } from "./fileUtils.js";
import { getConfigDir } from "./paths.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NavigatorModel {
  id: string;
  object: string;
  owned_by?: string;
  created?: number;
  [key: string]: unknown;
}

export interface ModelsCache {
  fetchedAt: string;
  models: NavigatorModel[];
}

export interface RefreshResult {
  count: number;
  added: string[];
  removed: string[];
  fetchedAt: string;
}

export interface ListFilter {
  provider?: string;
  modality?: string;
  min_context?: number;
  classification?: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────
//
// Resolve the config dir on every call so `setConfigDirOverride` (used by the
// test suite) actually redirects file I/O. Caching these as module-level
// constants would freeze them at import time, before any test override runs.

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour default

function modelsFile(): string {
  return join(getConfigDir(), "models.json");
}

function allowlistFile(): string {
  return join(getConfigDir(), "allowlist.json");
}

function ensureConfigDir(): void {
  mkdirSync(getConfigDir(), { recursive: true });
}

// ── Allowlist ─────────────────────────────────────────────────────────────────
//
// The allowlist is read on every inference-path call (chat / embeddings / image
// / STT / TTS), so we cache the parsed Set in memory with a short TTL. The file
// is typically static; 60s is well below user perception for "I just edited
// allowlist.json" while eliminating disk I/O on hot paths.
//
// Both the populated state and the "no file" state are cached, so the
// existsSync hit also amortizes. A malformed JSON file fails open (no
// allowlist) but emits a stderr warning so operators notice.

interface AllowlistCacheEntry {
  set: Set<string> | null;
  loadedAt: number;
}

const ALLOWLIST_TTL_MS = 60 * 1000;
let allowlistCache: AllowlistCacheEntry | null = null;

/** Force the next allowlist read to hit disk. Called by tests and `clearModelsCache`. */
export function clearAllowlistCache(): void {
  allowlistCache = null;
}

function readAllowlistFromDisk(): Set<string> | null {
  const file = allowlistFile();
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw) || !raw.every((id) => typeof id === "string")) {
      process.stderr.write(
        "[uf-navigator] WARNING: allowlist.json must be a JSON array of strings — failing open (all models allowed)\n",
      );
      return null;
    }
    return new Set((raw as string[]).map((id) => id.toLowerCase()));
  } catch (err) {
    process.stderr.write(
      `[uf-navigator] WARNING: allowlist.json could not be parsed (${(err as Error).message}) — failing open (all models allowed)\n`,
    );
    return null;
  }
}

function readAllowlist(): Set<string> | null {
  const now = Date.now();
  if (allowlistCache && now - allowlistCache.loadedAt < ALLOWLIST_TTL_MS) {
    return allowlistCache.set;
  }
  const set = readAllowlistFromDisk();
  allowlistCache = { set, loadedAt: now };
  return set;
}

function applyAllowlist(models: NavigatorModel[]): NavigatorModel[] {
  const allowed = readAllowlist();
  if (!allowed) return models; // no allowlist → pass through all
  return models.filter((m) => allowed.has(m.id.toLowerCase()));
}

/** Check whether a model ID is permitted by the allowlist (or if no allowlist, all are permitted). */
export function isModelAllowed(id: string): boolean {
  const allowed = readAllowlist();
  if (!allowed) return true;
  return allowed.has(id.toLowerCase());
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

function readCache(): ModelsCache | null {
  const file = modelsFile();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ModelsCache;
  } catch {
    return null;
  }
}

function writeCache(cache: ModelsCache): void {
  ensureConfigDir();
  atomicWriteFileSync(modelsFile(), JSON.stringify(cache, null, 2));
}

function isFresh(cache: ModelsCache, ttlMs = CACHE_TTL_MS): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age < ttlMs;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch /v1/models live, write cache, return diff vs previous cache. */
export async function refreshModels(): Promise<RefreshResult> {
  const prev = readCache();
  const prevIds = new Set((prev?.models ?? []).map((m) => m.id));

  const data = await navigatorJSON<{ data: NavigatorModel[] }>("/models");
  const models = data.data ?? [];

  const newIds = new Set(models.map((m) => m.id));
  const added = models.map((m) => m.id).filter((id) => !prevIds.has(id));
  const removed = [...prevIds].filter((id) => !newIds.has(id));

  const cache: ModelsCache = {
    fetchedAt: new Date().toISOString(),
    models,
  };
  writeCache(cache);

  return { count: models.length, added, removed, fetchedAt: cache.fetchedAt };
}

/**
 * Return cached model list.
 *
 * `apply_allowlist` (default true) decides whether `{configDir}/allowlist.json`
 * filters the result. User-facing callers (the `navigator_list_models` tool,
 * `navigator_health_check`) keep the filter on so users see only what they've
 * opted in to. Internal existence probes (`getModelById`, `modelExists`) pass
 * `false` — they should see the full gateway catalog so alias creation for a
 * valid-but-not-yet-allowlisted model doesn't spuriously warn "not found in
 * cache". The inference-path allowlist check lives separately in
 * `isModelAllowed` and is unaffected.
 */
export async function listModels(opts: {
  use_cache?: boolean;
  filter?: ListFilter;
  apply_allowlist?: boolean;
} = {}): Promise<NavigatorModel[]> {
  const { use_cache = true, filter, apply_allowlist = true } = opts;

  let cache = readCache();
  if (!cache || !use_cache || !isFresh(cache)) {
    await refreshModels();
    cache = readCache()!;
  }

  let models = apply_allowlist ? applyAllowlist(cache.models) : cache.models;

  if (filter) {
    if (filter.provider) {
      const p = filter.provider.toLowerCase();
      models = models.filter(
        (m) =>
          m.owned_by?.toLowerCase().includes(p) || m.id.toLowerCase().includes(p),
      );
    }
    // modality / min_context / classification: these come from spec cache,
    // so we can only do best-effort matching on model id string here.
    if (filter.modality) {
      const mod = filter.modality.toLowerCase();
      models = models.filter((m) => m.id.toLowerCase().includes(mod));
    }
    if (filter.classification) {
      const cls = filter.classification.toLowerCase();
      models = models.filter((m) =>
        String(m.classification ?? "").toLowerCase().includes(cls),
      );
    }
  }

  return models;
}

/**
 * Look up a single model by exact ID in the cache.
 *
 * Bypasses the allowlist so existence queries reflect the full gateway
 * catalog. Do NOT use this to decide whether a request is permitted — use
 * `isModelAllowed` for that.
 */
export async function getModelById(
  id: string,
): Promise<NavigatorModel | null> {
  const models = await listModels({ use_cache: true, apply_allowlist: false });
  return models.find((m) => m.id === id) ?? null;
}

/** Return true if the model id exists in the gateway catalog (allowlist-agnostic). For permission checks use `isModelAllowed`. */
export async function modelExists(id: string): Promise<boolean> {
  const m = await getModelById(id);
  return m !== null;
}

/**
 * Delete the models availability cache (models.json) and invalidate the
 * in-memory allowlist cache. Does not touch aliases, key, or other state.
 *
 * The allowlist invalidation is paired here so callers that wipe state after
 * an API key change (see `health.ts`) don't leave stale allowlist behavior
 * behind.
 */
export function clearModelsCache(): void {
  const file = modelsFile();
  if (existsSync(file)) unlinkSync(file);
  clearAllowlistCache();
}
