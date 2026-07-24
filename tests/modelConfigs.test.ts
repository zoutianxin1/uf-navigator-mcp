import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setConfigDirOverride } from "../src/navigator/paths.js";
import {
  deleteModelConfig,
  listModelConfigs,
  readModelConfig,
  updateThinkingSection,
  writeModelConfig,
} from "../src/navigator/modelConfigs.js";
import {
  buildDecisionRequiredText,
  resolveThinkingEffort,
} from "../src/navigator/thinking.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "uf-nav-modelcfg-"));
  setConfigDirOverride(tmpDir);
});

afterEach(() => {
  setConfigDirOverride(undefined);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("model configs — empty dir", () => {
  it("listModelConfigs returns empty list", () => {
    expect(listModelConfigs()).toEqual({ configs: [], skipped_unreadable: 0 });
  });

  it("readModelConfig returns null", () => {
    expect(readModelConfig("gpt-4o")).toBeNull();
  });
});

describe("model configs — round-trip write + read", () => {
  it("preserves model_id and thinking section, re-stamps updated_at", () => {
    writeModelConfig({
      model_id: "gpt-4o",
      updated_at: "2000-01-01T00:00:00.000Z", // will be overwritten
      thinking: {
        default_effort: "not_applicable",
        allowed_efforts: [],
        effort_field: null,
      },
    });
    const rt = readModelConfig("gpt-4o");
    expect(rt).toBeTruthy();
    expect(rt?.model_id).toBe("gpt-4o");
    expect(rt?.thinking?.default_effort).toBe("not_applicable");
    expect(rt?.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
  });
});

describe("model configs — corruption tolerance", () => {
  it("returns null and counts skipped on garbage JSON", () => {
    mkdirSync(join(tmpDir, "model_configs"), { recursive: true });
    writeFileSync(join(tmpDir, "model_configs", "garbage.json"), "not-json{{{", "utf8");
    expect(readModelConfig("garbage")).toBeNull();
    const listResult = listModelConfigs();
    expect(listResult.configs.length).toBe(0);
    expect(listResult.skipped_unreadable).toBe(1);
  });

  it("returns null and counts skipped on wrong-shape JSON", () => {
    mkdirSync(join(tmpDir, "model_configs"), { recursive: true });
    writeFileSync(join(tmpDir, "model_configs", "garbage.json"), "not-json{{{", "utf8");
    writeFileSync(
      join(tmpDir, "model_configs", "badshape.json"),
      JSON.stringify({ foo: "bar" }),
      "utf8",
    );
    expect(readModelConfig("badshape")).toBeNull();
    expect(listModelConfigs().skipped_unreadable).toBe(2);
  });
});

describe("resolveThinkingEffort — seed auto-materialization", () => {
  it("gpt-5.4 seed resolves to xhigh via reasoning_effort and writes a file", () => {
    expect(resolveThinkingEffort("gpt-5.4")).toEqual({
      kind: "apply",
      effort: "xhigh",
      field: "reasoning_effort",
    });
    const f = readModelConfig("gpt-5.4");
    expect(f).toBeTruthy();
    expect(f?.thinking?.default_effort).toBe("xhigh");
    expect(f?.thinking?.effort_field).toBe("reasoning_effort");
  });

  it("claude-4.7-opus seed resolves with output_config.effort (Bedrock fix)", () => {
    expect(resolveThinkingEffort("claude-4.7-opus")).toEqual({
      kind: "apply",
      effort: "xhigh",
      field: "output_config.effort",
    });
    const f = readModelConfig("claude-4.7-opus");
    expect(f?.thinking?.effort_field).toBe("output_config.effort");
  });
});

describe("resolveThinkingEffort — prompt path (no file, no seed)", () => {
  it("gpt-4o falls through to prompt and does NOT write a file", () => {
    const r = resolveThinkingEffort("gpt-4o");
    expect(r.kind).toBe("prompt");
    if (r.kind === "prompt") {
      expect(r.allowed).toEqual(["low", "medium", "high", "xhigh"]);
      expect(r.suggested).toBeUndefined();
    }
    expect(readModelConfig("gpt-4o")).toBeNull();
  });

  it("embedding model surfaces a not_applicable suggestion", () => {
    const r = resolveThinkingEffort("text-embedding-3-large");
    expect(r.kind).toBe("prompt");
    if (r.kind === "prompt") {
      expect(r.suggested?.value).toBe("not_applicable");
    }
  });
});

describe("resolveThinkingEffort — file-driven behavior", () => {
  it("stored not_applicable yields skip", () => {
    updateThinkingSection("gpt-4o", {
      default_effort: "not_applicable",
      allowed_efforts: [],
      effort_field: null,
    });
    expect(resolveThinkingEffort("gpt-4o")).toEqual({ kind: "skip" });
  });

  it("stored effort yields apply with that effort and field", () => {
    updateThinkingSection("gpt-4o", {
      default_effort: "high",
      allowed_efforts: ["low", "medium", "high", "xhigh"],
      effort_field: "reasoning_effort",
    });
    expect(resolveThinkingEffort("gpt-4o")).toEqual({
      kind: "apply",
      effort: "high",
      field: "reasoning_effort",
    });
  });

  it("explicit effort beats file's not_applicable", () => {
    updateThinkingSection("gpt-4o", {
      default_effort: "not_applicable",
      allowed_efforts: [],
      effort_field: null,
    });
    expect(resolveThinkingEffort("gpt-4o", "high")).toEqual({
      kind: "apply",
      effort: "high",
      field: "reasoning_effort",
    });
  });

  it("explicit not_applicable yields skip even on a seeded model", () => {
    expect(resolveThinkingEffort("gpt-5.4", "not_applicable")).toEqual({ kind: "skip" });
  });

  it("explicit invalid value throws", () => {
    expect(() => resolveThinkingEffort("gpt-4o", "banana")).toThrow();
  });
});

describe("updateThinkingSection — delete + sibling preservation", () => {
  it("removing the only section collapses the whole file", () => {
    updateThinkingSection("gpt-4o", {
      default_effort: "high",
      allowed_efforts: ["low", "medium", "high", "xhigh"],
      effort_field: "reasoning_effort",
    });
    expect(readModelConfig("gpt-4o")).toBeTruthy();
    updateThinkingSection("gpt-4o", null);
    expect(readModelConfig("gpt-4o")).toBeNull();
  });

  it("preserves unknown sibling sections through configure", () => {
    mkdirSync(join(tmpDir, "model_configs"), { recursive: true });
    writeFileSync(
      join(tmpDir, "model_configs", "claude-4.7-opus.json"),
      JSON.stringify(
        {
          model_id: "claude-4.7-opus",
          updated_at: "2026-01-01T00:00:00.000Z",
          thinking: {
            default_effort: "xhigh",
            allowed_efforts: ["low", "medium", "high", "xhigh", "max"],
            effort_field: "output_config.effort",
          },
          vision: { placeholder: "future" },
        },
        null,
        2,
      ),
      "utf8",
    );
    updateThinkingSection("claude-4.7-opus", {
      default_effort: "high",
      allowed_efforts: ["low", "medium", "high", "xhigh", "max"],
      effort_field: "output_config.effort",
    });
    const preserved = readModelConfig("claude-4.7-opus");
    expect(preserved?.vision).toEqual({ placeholder: "future" });
    expect(preserved?.thinking?.default_effort).toBe("high");
  });

  it("deleting thinking while sibling section remains keeps the file", () => {
    mkdirSync(join(tmpDir, "model_configs"), { recursive: true });
    writeFileSync(
      join(tmpDir, "model_configs", "claude-4.7-opus.json"),
      JSON.stringify(
        {
          model_id: "claude-4.7-opus",
          updated_at: "2026-01-01T00:00:00.000Z",
          thinking: {
            default_effort: "xhigh",
            allowed_efforts: ["low", "medium", "high", "xhigh", "max"],
            effort_field: "output_config.effort",
          },
          vision: { placeholder: "future" },
        },
        null,
        2,
      ),
      "utf8",
    );
    updateThinkingSection("claude-4.7-opus", null);
    const after = readModelConfig("claude-4.7-opus");
    expect(after).toBeTruthy();
    expect(after?.thinking).toBeUndefined();
    expect(after?.vision).toEqual({ placeholder: "future" });
  });
});

describe("buildDecisionRequiredText — bounded payload + stable schema", () => {
  it("includes the header and decision-context block", () => {
    const payload = buildDecisionRequiredText({
      kind: "prompt",
      model: "gpt-4o",
      allowed: ["low", "medium", "high", "xhigh"],
      suggested: undefined,
    });
    expect(payload).toContain("THINKING_EFFORT_DECISION_REQUIRED");
    expect(payload).toContain("<decision-context>");
    expect(payload.length).toBeLessThan(800);
  });

  it("emits decision-context JSON keys in stable order (model → allowed → suggested)", () => {
    const payload = buildDecisionRequiredText({
      kind: "prompt",
      model: "gpt-4o",
      allowed: ["low", "medium", "high", "xhigh"],
      suggested: undefined,
    });
    const ctxMatch = payload.match(/<decision-context>(.+)<\/decision-context>/);
    expect(ctxMatch).toBeTruthy();
    const ctxStr = ctxMatch![1];
    expect(ctxStr.indexOf('"model"')).toBeLessThan(ctxStr.indexOf('"allowed"'));
    expect(ctxStr.indexOf('"allowed"')).toBeLessThan(ctxStr.indexOf('"suggested"'));
  });

  it("shows the Suggested line when a suggestion is provided", () => {
    const payload = buildDecisionRequiredText({
      kind: "prompt",
      model: "text-embedding-3-large",
      allowed: [],
      suggested: { value: "not_applicable", reason: "embedding model" },
    });
    expect(payload).toContain("Suggested:");
  });
});

describe("listModelConfigs", () => {
  it("lists seeded files and reports zero skips", () => {
    resolveThinkingEffort("gpt-5.4"); // auto-materializes
    resolveThinkingEffort("claude-4.7-opus"); // auto-materializes
    const listed = listModelConfigs();
    expect(listed.configs.length).toBe(2);
    expect(listed.skipped_unreadable).toBe(0);
  });
});

describe("deleteModelConfig", () => {
  it("returns true on first delete and false on second", () => {
    resolveThinkingEffort("gpt-5.4");
    expect(readModelConfig("gpt-5.4")).toBeTruthy();
    expect(deleteModelConfig("gpt-5.4")).toBe(true);
    expect(readModelConfig("gpt-5.4")).toBeNull();
    expect(deleteModelConfig("gpt-5.4")).toBe(false);
  });
});
