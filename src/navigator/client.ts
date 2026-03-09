import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { join } from "node:path";
import { atomicWriteFileSync } from "./fileUtils.js";
import { getConfigDir } from "./paths.js";

// ── Config ────────────────────────────────────────────────────────────────────

const KEY_FILE = join(getConfigDir(), "key");

function loadKey(): string {
  // 1. Environment variable
  const envKey = process.env.UF_NAVIGATOR_API_KEY;
  if (envKey?.trim()) return envKey.trim();

  // 2. Key file
  try {
    const key = readFileSync(KEY_FILE, "utf8").trim();
    if (!key) throw new Error("Key file is empty");

    // Warn if world-readable (Unix only; skip on Windows where mode bits differ)
    if (process.platform !== "win32") {
      const mode = statSync(KEY_FILE).mode;
      if (mode & 0o004) {
        process.stderr.write(
          `[uf-navigator] WARNING: ${KEY_FILE} is world-readable. ` +
            `Run: chmod 600 ${KEY_FILE}\n`,
        );
      }
    }
    return key;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  throw new Error(
    "UF NaviGator API key not found.\n" +
      "Set env var UF_NAVIGATOR_API_KEY or write key to " +
      KEY_FILE,
  );
}

export const BASE_URL: string =
  (process.env.UF_NAVIGATOR_BASE_URL ?? "https://api.ai.it.ufl.edu/v1").replace(
    /\/$/,
    "",
  );

let _key: string | undefined;
export function getKey(): string {
  if (!_key) _key = loadKey();
  return _key;
}

/** Set the API key at runtime. Default: in-memory only. Pass persist: true to write to config dir. */
export function setKey(newKey: string, opts: { persist?: boolean } = {}): void {
  const { persist = false } = opts;
  _key = newKey.trim();
  if (persist) {
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    // mode: 0o600 — on Windows, Node ignores POSIX mode bits; files inherit parent ACLs
    atomicWriteFileSync(KEY_FILE, _key, 0o600);
  }
}

/** Clear the cached API key, forcing re-read on next getKey() call. */
export function clearKeyCache(): void {
  _key = undefined;
}

// ── Key redaction ─────────────────────────────────────────────────────────────

export function redactKey(text: string): string {
  try {
    const k = getKey();
    if (!k) return text;
    return text.split(k).join("[REDACTED]");
  } catch {
    return text;
  }
}

// ── Structured logger ─────────────────────────────────────────────────────────

export interface LogEntry {
  ts: string;
  requestId: string;
  path: string;
  model?: string;
  latency_ms?: number;
  tokens?: number;
  status?: number;
  error?: string;
}

let _reqCounter = 0;
export function newRequestId(): string {
  return `req-${++_reqCounter}`;
}

export function logEntry(entry: LogEntry): void {
  // Never log the key; use stderr so stdout stays clean for MCP protocol
  process.stderr.write(redactKey(JSON.stringify(entry)) + "\n");
}

// ── HTTP client ───────────────────────────────────────────────────────────────

export type FetchOptions = {
  method?: string;
  body?: string | FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export class NavigatorError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly requestId: string,
  ) {
    super(`Navigator API error ${status}: ${redactKey(body)}`);
    this.name = "NavigatorError";
  }
}

export async function navigatorFetch(
  path: string,
  opts: FetchOptions = {},
  model?: string,
): Promise<Response> {
  const key = getKey();
  const url = `${BASE_URL}${path}`;
  const requestId = newRequestId();
  const t0 = Date.now();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    ...opts.headers,
  };
  if (opts.body && typeof opts.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
      signal: opts.signal,
    });
  } catch (err) {
    logEntry({
      ts: new Date().toISOString(),
      requestId,
      path,
      model,
      error: redactKey(String(err)),
    });
    throw new Error(`Network error calling ${path}: ${redactKey(String(err))}`);
  }

  const latency_ms = Date.now() - t0;

  if (!response.ok) {
    const body = await response.text();
    logEntry({
      ts: new Date().toISOString(),
      requestId,
      path,
      model,
      status: response.status,
      latency_ms,
      error: `HTTP ${response.status}`,
    });
    throw new NavigatorError(response.status, body, requestId);
  }

  logEntry({
    ts: new Date().toISOString(),
    requestId,
    path,
    model,
    status: response.status,
    latency_ms,
  });

  return response;
}

export async function navigatorJSON<T>(
  path: string,
  opts: FetchOptions = {},
  model?: string,
): Promise<T> {
  const response = await navigatorFetch(path, opts, model);
  return response.json() as Promise<T>;
}
