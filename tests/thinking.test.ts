import { describe, expect, it } from "vitest";
import {
  allowedEffortsFor,
  applyThinkingEffort,
  defaultEffortFor,
  detectFamily,
  effortFieldFor,
  suggestDefault,
} from "../src/navigator/thinking.js";

describe("detectFamily", () => {
  it("detects gpt-5.4 as openai", () => {
    expect(detectFamily("gpt-5.4")).toBe("openai");
  });
  it("detects gpt-4o as openai", () => {
    expect(detectFamily("gpt-4o")).toBe("openai");
  });
  it("detects o1-mini as openai", () => {
    expect(detectFamily("o1-mini")).toBe("openai");
  });
  it("detects o3-mini as openai", () => {
    expect(detectFamily("o3-mini")).toBe("openai");
  });
  it("detects claude-4.7-opus as anthropic", () => {
    expect(detectFamily("claude-4.7-opus")).toBe("anthropic");
  });
  it("detects claude-4.6-sonnet as anthropic", () => {
    expect(detectFamily("claude-4.6-sonnet")).toBe("anthropic");
  });
  it("detects gemini-3.1-pro as google", () => {
    expect(detectFamily("gemini-3.1-pro")).toBe("google");
  });
  it("detects text-embedding-3-large as other", () => {
    expect(detectFamily("text-embedding-3-large")).toBe("other");
  });
  it("detects whisper-1 as other", () => {
    expect(detectFamily("whisper-1")).toBe("other");
  });
});

describe("defaultEffortFor — narrowed to gpt-5.X / opus-4.7 / gemini-3.X", () => {
  it("seeds gpt-5.4 to xhigh", () => {
    expect(defaultEffortFor("gpt-5.4")).toBe("xhigh");
  });
  it("seeds gpt-5 to xhigh", () => {
    expect(defaultEffortFor("gpt-5")).toBe("xhigh");
  });
  it("seeds gemini-3.1-pro to high", () => {
    expect(defaultEffortFor("gemini-3.1-pro")).toBe("high");
  });
  it("seeds gemini-3 to high", () => {
    expect(defaultEffortFor("gemini-3")).toBe("high");
  });
  it("seeds claude-4.7-opus to xhigh", () => {
    expect(defaultEffortFor("claude-4.7-opus")).toBe("xhigh");
  });

  it("does NOT seed gpt-4o (narrowed away)", () => {
    expect(defaultEffortFor("gpt-4o")).toBeUndefined();
  });
  it("does NOT seed gpt-4-turbo", () => {
    expect(defaultEffortFor("gpt-4-turbo")).toBeUndefined();
  });
  it("does NOT seed o1-mini", () => {
    expect(defaultEffortFor("o1-mini")).toBeUndefined();
  });
  it("does NOT seed o3-mini", () => {
    expect(defaultEffortFor("o3-mini")).toBeUndefined();
  });
  it("does NOT seed claude-4.7-sonnet (opus-only)", () => {
    expect(defaultEffortFor("claude-4.7-sonnet")).toBeUndefined();
  });
  it("does NOT seed claude-4.7-haiku (opus-only)", () => {
    expect(defaultEffortFor("claude-4.7-haiku")).toBeUndefined();
  });
  it("does NOT seed claude-4.6-opus (4.7-only)", () => {
    expect(defaultEffortFor("claude-4.6-opus")).toBeUndefined();
  });
  it("does NOT seed claude-4.5-opus", () => {
    expect(defaultEffortFor("claude-4.5-opus")).toBeUndefined();
  });
  it("does NOT seed gemini-2.5-pro (3.X-only)", () => {
    expect(defaultEffortFor("gemini-2.5-pro")).toBeUndefined();
  });
  it("does NOT seed embeddings", () => {
    expect(defaultEffortFor("text-embedding-3-large")).toBeUndefined();
  });
  it("does NOT seed unknown families", () => {
    expect(defaultEffortFor("some-weird-model")).toBeUndefined();
  });
});

describe("allowedEffortsFor", () => {
  it("openai vocabulary", () => {
    expect(allowedEffortsFor("gpt-5.4")).toEqual(["low", "medium", "high", "xhigh"]);
  });
  it("gemini vocabulary", () => {
    expect(allowedEffortsFor("gemini-3.1-pro")).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "disable",
    ]);
  });
  it("anthropic 4.7 vocabulary", () => {
    expect(allowedEffortsFor("claude-4.7-opus")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
  it("anthropic 4.6 vocabulary", () => {
    expect(allowedEffortsFor("claude-4.6-opus")).toEqual(["low", "medium", "high", "max"]);
  });
  it("anthropic older vocabulary", () => {
    expect(allowedEffortsFor("claude-4.5-opus")).toEqual(["low", "medium", "high"]);
  });
  it("empty vocabulary for non-chat 'other' models", () => {
    expect(allowedEffortsFor("text-embedding-3-large")).toEqual([]);
  });
});

describe("effortFieldFor — Claude 4.7 gateway routing", () => {
  it("claude-4.7-opus → output_config.effort (Bedrock requirement)", () => {
    expect(effortFieldFor("claude-4.7-opus")).toBe("output_config.effort");
  });
  it("claude-4.7-sonnet → output_config.effort", () => {
    expect(effortFieldFor("claude-4.7-sonnet")).toBe("output_config.effort");
  });
  it("claude-4.6-opus → reasoning_effort", () => {
    expect(effortFieldFor("claude-4.6-opus")).toBe("reasoning_effort");
  });
  it("older claude → reasoning_effort", () => {
    expect(effortFieldFor("claude-3.5-sonnet")).toBe("reasoning_effort");
  });
  it("openai → reasoning_effort", () => {
    expect(effortFieldFor("gpt-5.4")).toBe("reasoning_effort");
  });
  it("gemini → reasoning_effort", () => {
    expect(effortFieldFor("gemini-3.1-pro")).toBe("reasoning_effort");
  });
});

describe("applyThinkingEffort — refactored signature (body, effort, field)", () => {
  it("applies the reasoning_effort field at top level", () => {
    const body: Record<string, unknown> = {};
    applyThinkingEffort(body, "xhigh", "reasoning_effort");
    expect(body).toEqual({ reasoning_effort: "xhigh" });
  });

  it("applies the output_config.effort field as a nested object", () => {
    const body: Record<string, unknown> = {};
    applyThinkingEffort(body, "xhigh", "output_config.effort");
    expect(body).toEqual({ output_config: { effort: "xhigh" } });
  });

  it("merges into an existing output_config object", () => {
    const body: Record<string, unknown> = { output_config: { adaptive: true } };
    applyThinkingEffort(body, "max", "output_config.effort");
    expect(body).toEqual({ output_config: { adaptive: true, effort: "max" } });
  });

  it("normalizes the effort value to lowercase", () => {
    const body: Record<string, unknown> = {};
    applyThinkingEffort(body, "HIGH", "reasoning_effort");
    expect(body).toEqual({ reasoning_effort: "high" });
  });

  it("throws on an unknown field name", () => {
    expect(() =>
      applyThinkingEffort({}, "xhigh", "bogus" as "reasoning_effort"),
    ).toThrow();
  });
});

describe("suggestDefault — non-reasoning model ID heuristic", () => {
  it("suggests not_applicable for embeddings", () => {
    expect(suggestDefault("text-embedding-3-large")).toEqual({
      value: "not_applicable",
      reason: "embedding model",
    });
  });
  it("suggests not_applicable for whisper", () => {
    expect(suggestDefault("whisper-1")).toEqual({
      value: "not_applicable",
      reason: "speech-to-text model",
    });
  });
  it("suggests not_applicable for tts", () => {
    expect(suggestDefault("kokoro-v1")).toEqual({
      value: "not_applicable",
      reason: "text-to-speech model",
    });
  });
  it("suggests not_applicable for image gen", () => {
    expect(suggestDefault("dall-e-3")).toEqual({
      value: "not_applicable",
      reason: "image-generation model",
    });
  });
  it("returns undefined for reasoning models", () => {
    expect(suggestDefault("gpt-5.4")).toBeUndefined();
  });
  it("returns undefined for Claude", () => {
    expect(suggestDefault("claude-4.7-opus")).toBeUndefined();
  });
});
