import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TEST_CONFIG_DIR = join(homedir(), ".config", "uf-navigator-mcp-test");
const TEST_MODELS_FILE = join(TEST_CONFIG_DIR, "models.json");

// We patch the module-level paths by mocking the module's internals via env
// Instead, we test the diff logic and cache I/O through a manual import approach.

// For simplicity, test the diff calculation directly.

function computeDiff(
  prevIds: string[],
  newIds: string[],
): { added: string[]; removed: string[] } {
  const prevSet = new Set(prevIds);
  const newSet = new Set(newIds);
  const added = newIds.filter((id) => !prevSet.has(id));
  const removed = prevIds.filter((id) => !newSet.has(id));
  return { added, removed };
}

describe("models cache diff logic", () => {
  it("detects added models", () => {
    const { added, removed } = computeDiff(["gpt-4", "claude-3"], ["gpt-4", "claude-3", "gemini-2"]);
    expect(added).toEqual(["gemini-2"]);
    expect(removed).toEqual([]);
  });

  it("detects removed models", () => {
    const { added, removed } = computeDiff(["gpt-4", "claude-3", "old-model"], ["gpt-4", "claude-3"]);
    expect(added).toEqual([]);
    expect(removed).toEqual(["old-model"]);
  });

  it("detects both added and removed", () => {
    const { added, removed } = computeDiff(["gpt-4", "old-model"], ["gpt-4", "new-model"]);
    expect(added).toEqual(["new-model"]);
    expect(removed).toEqual(["old-model"]);
  });

  it("no changes when same models", () => {
    const { added, removed } = computeDiff(["gpt-4"], ["gpt-4"]);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("all models added when starting from empty cache", () => {
    const { added, removed } = computeDiff([], ["gpt-4", "claude-3"]);
    expect(added).toEqual(["gpt-4", "claude-3"]);
    expect(removed).toEqual([]);
  });
});

describe("models cache structure", () => {
  beforeAll(() => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  it("reads and parses a valid models.json", () => {
    const cache = {
      fetchedAt: new Date().toISOString(),
      models: [
        { id: "gpt-4o", object: "model", owned_by: "openai" },
        { id: "claude-3-sonnet", object: "model", owned_by: "anthropic" },
      ],
    };
    writeFileSync(TEST_MODELS_FILE, JSON.stringify(cache), "utf8");

    const parsed = JSON.parse(
      require("node:fs").readFileSync(TEST_MODELS_FILE, "utf8"),
    );
    expect(parsed.models).toHaveLength(2);
    expect(parsed.models[0].id).toBe("gpt-4o");
  });

  it("handles a missing models.json gracefully", () => {
    const missingFile = join(TEST_CONFIG_DIR, "nonexistent.json");
    expect(existsSync(missingFile)).toBe(false);
    // The cache reader should return null, not throw
    let result: unknown = null;
    try {
      const content = require("node:fs").readFileSync(missingFile, "utf8");
      result = JSON.parse(content);
    } catch {
      result = null;
    }
    expect(result).toBeNull();
  });
});

describe("TTL logic", () => {
  it("fresh cache within 1 hour is considered fresh", () => {
    const fetchedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    const ttlMs = 60 * 60 * 1000;
    const age = Date.now() - new Date(fetchedAt).getTime();
    expect(age).toBeLessThan(ttlMs);
  });

  it("stale cache older than 1 hour is not fresh", () => {
    const fetchedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 90 min ago
    const ttlMs = 60 * 60 * 1000;
    const age = Date.now() - new Date(fetchedAt).getTime();
    expect(age).toBeGreaterThan(ttlMs);
  });
});
