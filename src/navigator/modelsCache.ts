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

const CONFIG_DIR = getConfigDir();
const MODELS_FILE = join(CONFIG_DIR, "models.json");
const ALLOWLIST_FILE = join(CONFIG_DIR, "allowlist.json");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour default

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
}

// ── Allowlist ─────────────────────────────────────────────────────────────────

function readAllowlist(): Set<string> | null {
  if (!existsSync(ALLOWLIST_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(ALLOWLIST_FILE, "utf8")) as string[];
    if (!Array.isArray(raw)) return null;
    return new Set(raw.map((id) => id.toLowerCase()));
  } catch {
    return null;
  }
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
  if (!existsSync(MODELS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(MODELS_FILE, "utf8")) as ModelsCache;
  } catch {
    return null;
  }
}

function writeCache(cache: ModelsCache): void {
  ensureConfigDir();
  atomicWriteFileSync(MODELS_FILE, JSON.stringify(cache, null, 2));
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

/** Return cached model list; optionally refresh if stale or forced. */
export async function listModels(opts: {
  use_cache?: boolean;
  filter?: ListFilter;
} = {}): Promise<NavigatorModel[]> {
  const { use_cache = true, filter } = opts;

  let cache = readCache();
  if (!cache || !use_cache || !isFresh(cache)) {
    await refreshModels();
    cache = readCache()!;
  }

  let models = applyAllowlist(cache.models);

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

/** Look up a single model by exact ID in the cache. */
export async function getModelById(
  id: string,
): Promise<NavigatorModel | null> {
  const models = await listModels({ use_cache: true });
  return models.find((m) => m.id === id) ?? null;
}

/** Return true if the model id exists in the cache (for alias validation). */
export async function modelExists(id: string): Promise<boolean> {
  const m = await getModelById(id);
  return m !== null;
}

/** Delete ONLY the models availability cache (models.json). Does not touch aliases, key, or other state. */
export function clearModelsCache(): void {
  if (existsSync(MODELS_FILE)) unlinkSync(MODELS_FILE);
}
