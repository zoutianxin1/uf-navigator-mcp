import {
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setConfigDirOverride } from "../src/navigator/paths.js";
import {
  clearAllowlistCache,
  clearModelsCache,
  isModelAllowed,
} from "../src/navigator/modelsCache.js";

// All tests share this scaffolding: temp config dir per test, allowlist cache
// cleared before and after, stderr writes intercepted so we don't pollute the
// vitest output and so we can assert on the warning content.

let tmpDir: string;
let allowlistFile: string;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "uf-nav-allowlist-"));
  setConfigDirOverride(tmpDir);
  allowlistFile = join(tmpDir, "allowlist.json");
  clearAllowlistCache();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  setConfigDirOverride(undefined);
  rmSync(tmpDir, { recursive: true, force: true });
  clearAllowlistCache();
  stderrSpy.mockRestore();
});

describe("isModelAllowed — basic semantics", () => {
  it("returns true for any id when allowlist.json is absent", () => {
    expect(isModelAllowed("gpt-4o")).toBe(true);
    expect(isModelAllowed("claude-4.7-opus")).toBe(true);
    expect(isModelAllowed("anything-at-all")).toBe(true);
  });

  it("returns true for an id present in the allowlist", () => {
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o", "claude-4.7-opus"]));
    expect(isModelAllowed("gpt-4o")).toBe(true);
    expect(isModelAllowed("claude-4.7-opus")).toBe(true);
  });

  it("returns false for an id missing from the allowlist", () => {
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o"]));
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false);
    expect(isModelAllowed("")).toBe(false);
  });

  it("matches case-insensitively", () => {
    writeFileSync(allowlistFile, JSON.stringify(["gpt-5.4"]));
    expect(isModelAllowed("GPT-5.4")).toBe(true);
    expect(isModelAllowed("Gpt-5.4")).toBe(true);
    expect(isModelAllowed("gpt-5.4")).toBe(true);
  });
});

describe("isModelAllowed — fail-open hygiene", () => {
  it("falls back to 'no allowlist' when JSON is malformed AND emits a stderr warning", () => {
    writeFileSync(allowlistFile, "{ this is not valid json");
    expect(isModelAllowed("anything")).toBe(true);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const msg = String(stderrSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/allowlist\.json/);
    expect(msg).toMatch(/failing open/);
  });

  it("falls back to 'no allowlist' when contents are not an array of strings", () => {
    writeFileSync(allowlistFile, JSON.stringify({ not: "an array" }));
    expect(isModelAllowed("anything")).toBe(true);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const msg = String(stderrSpy.mock.calls[0]?.[0] ?? "");
    expect(msg).toMatch(/array of strings/);
  });

  it("falls back to 'no allowlist' when the array contains non-strings", () => {
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o", 42, null]));
    expect(isModelAllowed("gpt-4o")).toBe(true); // permissive: no allowlist applied
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });
});

describe("isModelAllowed — TTL cache", () => {
  it("caches the result so repeated calls do not re-read disk within the TTL", () => {
    // Seed the file, prime the cache.
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o"]));
    expect(isModelAllowed("gpt-4o")).toBe(true);
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false);

    // Delete the file from disk. If the cache works, subsequent calls still
    // see the original allowlist and reject `gemini-3.1-pro`. If the cache
    // were bypassed, `readAllowlist` would observe the missing file and
    // return null → all models allowed → `gemini-3.1-pro` would become true.
    unlinkSync(allowlistFile);

    expect(isModelAllowed("gpt-4o")).toBe(true);
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false); // proves cache hit
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false);
  });

  it("clearAllowlistCache forces a re-read", () => {
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o"]));
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false); // primes cache

    // Now widen the allowlist on disk.
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o", "gemini-3.1-pro"]));
    // Pre-clear: still cached, still rejected.
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false);

    clearAllowlistCache();
    expect(isModelAllowed("gemini-3.1-pro")).toBe(true);
  });

  it("clearModelsCache also invalidates the allowlist cache", () => {
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o"]));
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false); // prime

    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o", "gemini-3.1-pro"]));
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false); // still cached

    // The pairing exists so an API-key change (which calls clearModelsCache
    // from health.ts) doesn't leave stale allowlist state behind.
    clearModelsCache();
    expect(isModelAllowed("gemini-3.1-pro")).toBe(true);
  });

  it("missing-file state is also cached (existsSync amortized)", () => {
    // No allowlist file exists.
    expect(isModelAllowed("anything")).toBe(true);

    // Now create one. Without a cache miss, we should still see "all allowed".
    writeFileSync(allowlistFile, JSON.stringify(["gpt-4o"]));
    expect(isModelAllowed("gemini-3.1-pro")).toBe(true); // cached "no allowlist"

    clearAllowlistCache();
    expect(isModelAllowed("gemini-3.1-pro")).toBe(false);
  });
});
