/**
 * B3 regression suite: the allowlist must filter the user-facing model list
 * (navigator_list_models, navigator_health_check) WITHOUT hiding models from
 * internal existence probes (getModelById / modelExists / setAlias warning).
 *
 * Setup: we don't hit the gateway. Each test seeds models.json and (optionally)
 * allowlist.json directly in a per-suite tmp config dir, then calls the public
 * API.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setConfigDirOverride } from "../src/navigator/paths.js";
import {
  getModelById,
  listModels,
  modelExists,
} from "../src/navigator/modelsCache.js";

const ALL_MODELS = ["gpt-4o", "gpt-5.4", "claude-4.7-opus", "gemini-3.1-pro"];

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "uf-nav-allowlist-existence-"));
  setConfigDirOverride(tmpDir);
});

afterEach(() => {
  setConfigDirOverride(undefined);
  rmSync(tmpDir, { recursive: true, force: true });
});

function seed({
  allowlist,
  models,
}: {
  allowlist?: string[];
  models: string[];
}): void {
  writeFileSync(
    join(tmpDir, "models.json"),
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        models: models.map((id) => ({ id, object: "model" })),
      },
      null,
      2,
    ),
  );
  if (allowlist) {
    writeFileSync(join(tmpDir, "allowlist.json"), JSON.stringify(allowlist));
  }
}

describe("no allowlist file present", () => {
  it("listModels returns the full catalog", async () => {
    seed({ models: ALL_MODELS });
    const list = await listModels({ use_cache: true });
    expect(list.length).toBe(4);
  });

  it("modelExists is true for any cached model", async () => {
    seed({ models: ALL_MODELS });
    expect(await modelExists("gemini-3.1-pro")).toBe(true);
  });
});

describe("user-facing listing respects the allowlist", () => {
  it("excludes a non-allowlisted model from listModels", async () => {
    seed({
      models: ALL_MODELS,
      allowlist: ["gpt-4o", "gpt-5.4", "claude-4.7-opus"],
    });
    const userFacing = await listModels({ use_cache: true });
    expect(userFacing.map((m) => m.id).sort()).toEqual([
      "claude-4.7-opus",
      "gpt-4o",
      "gpt-5.4",
    ]);
  });
});

describe("B3 regression: existence probes ignore the allowlist", () => {
  it("modelExists returns true for a real-but-not-allowlisted model", async () => {
    seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
    expect(await modelExists("gemini-3.1-pro")).toBe(true);
  });

  it("modelExists returns true for an allowlisted model", async () => {
    seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
    expect(await modelExists("gpt-4o")).toBe(true);
  });

  it("modelExists returns false for a genuinely missing model", async () => {
    seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
    expect(await modelExists("nonexistent-model")).toBe(false);
  });

  it("getModelById returns a non-allowlisted but cached model", async () => {
    seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
    const m = await getModelById("claude-4.7-opus");
    expect(m).toBeTruthy();
  });
});

describe("listModels.apply_allowlist flag", () => {
  it("apply_allowlist: false returns the full catalog", async () => {
    seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
    const unfiltered = await listModels({
      use_cache: true,
      apply_allowlist: false,
    });
    expect(unfiltered.length).toBe(4);
  });

  it("apply_allowlist: true returns only allowlisted models", async () => {
    seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
    const filtered = await listModels({
      use_cache: true,
      apply_allowlist: true,
    });
    expect(filtered.length).toBe(1);
  });
});
