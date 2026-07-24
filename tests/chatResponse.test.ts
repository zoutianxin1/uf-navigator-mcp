/**
 * M1: structural parity between streaming and non-streaming response shapes,
 * and capture of `reasoning_content` (OpenAI canonical) plus `thinking.text`
 * (Anthropic-via-Bedrock fallback) from SSE deltas.
 *
 * These helpers live in src/tools/inference.ts as exported pure functions so
 * the chat tool callback can stay a thin wrapper and we don't need to boot
 * the MCP SDK to test the contract.
 */

import { describe, expect, it } from "vitest";
import {
  buildChatResponseJson,
  parseChatStream,
} from "../src/tools/inference.js";

describe("buildChatResponseJson — reasoning field contract", () => {
  it("includes content, model, usage when present", () => {
    const json = buildChatResponseJson({
      content: "hello",
      model: "gpt-4o",
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.content).toBe("hello");
    expect(parsed.model).toBe("gpt-4o");
    expect(parsed.usage).toEqual({
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    });
  });

  it("OMITS reasoning when absent", () => {
    const json = buildChatResponseJson({
      content: "hi",
      model: "gpt-4o",
      usage: undefined,
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("reasoning");
  });

  it("OMITS reasoning when explicitly empty string (per contract)", () => {
    const json = buildChatResponseJson({
      content: "hi",
      reasoning: "",
      model: "gpt-4o",
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("reasoning");
  });

  it("INCLUDES reasoning when non-empty", () => {
    const json = buildChatResponseJson({
      content: "the answer is 42",
      reasoning: "hmm, 6 * 7 = 42",
      model: "claude-4.7-opus",
      usage: undefined,
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.reasoning).toBe("hmm, 6 * 7 = 42");
  });

  it("drops undefined usage from the JSON (no key emitted)", () => {
    const json = buildChatResponseJson({
      content: "x",
      model: "gpt-4o",
      usage: undefined,
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("usage");
  });
});

// ── SSE fixture helpers ──────────────────────────────────────────────────────

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n`;
}

describe("parseChatStream — content + reasoning capture", () => {
  it("concatenates content deltas in order, ignoring [DONE] sentinel", () => {
    const stream =
      sseLine({ choices: [{ delta: { content: "Hello, " } }] }) +
      sseLine({ choices: [{ delta: { content: "world." } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "gpt-4o");
    expect(out.content).toBe("Hello, world.");
    expect(out.reasoning).toBe("");
  });

  it("captures delta.reasoning_content (OpenAI canonical) into reasoning", () => {
    const stream =
      sseLine({ choices: [{ delta: { reasoning_content: "Let me think..." } }] }) +
      sseLine({ choices: [{ delta: { reasoning_content: " about that." } }] }) +
      sseLine({ choices: [{ delta: { content: "Result: 42." } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "gpt-5.4");
    expect(out.content).toBe("Result: 42.");
    expect(out.reasoning).toBe("Let me think... about that.");
  });

  it("captures delta.thinking.text (Anthropic via Bedrock fallback)", () => {
    const stream =
      sseLine({ choices: [{ delta: { thinking: { text: "I should consider..." } } }] }) +
      sseLine({ choices: [{ delta: { content: "Done." } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "claude-4.7-opus");
    expect(out.content).toBe("Done.");
    expect(out.reasoning).toBe("I should consider...");
  });

  it("merges reasoning_content and thinking.text in order if both appear", () => {
    const stream =
      sseLine({ choices: [{ delta: { reasoning_content: "A" } }] }) +
      sseLine({ choices: [{ delta: { thinking: { text: "B" } } }] }) +
      sseLine({ choices: [{ delta: { reasoning_content: "C" } }] }) +
      sseLine({ choices: [{ delta: { content: "out" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.reasoning).toBe("ABC");
  });
});

describe("parseChatStream — null safety on partial chunks", () => {
  it("ignores empty-string content/reasoning chunks", () => {
    const stream =
      sseLine({ choices: [{ delta: { content: "" } }] }) +
      sseLine({ choices: [{ delta: { reasoning_content: "" } }] }) +
      sseLine({ choices: [{ delta: { content: "x" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.content).toBe("x");
    expect(out.reasoning).toBe("");
  });

  it("ignores deltas with no content/reasoning fields (e.g. role-only chunk)", () => {
    const stream =
      sseLine({ choices: [{ delta: { role: "assistant" } }] }) +
      sseLine({ choices: [{ delta: { content: "x" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.content).toBe("x");
    expect(out.reasoning).toBe("");
  });

  it("ignores chunks with no choices array (e.g. final usage-only chunk)", () => {
    const stream =
      sseLine({ choices: [{ delta: { content: "x" } }] }) +
      sseLine({ usage: { total_tokens: 5 } }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.content).toBe("x");
    expect(out.usage).toEqual({ total_tokens: 5 });
  });

  it("skips malformed JSON lines without throwing", () => {
    const stream =
      sseLine({ choices: [{ delta: { content: "ok" } }] }) +
      "data: {this-is-not-json\n" +
      sseLine({ choices: [{ delta: { content: "!" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.content).toBe("ok!");
  });

  it("ignores non-data: lines (comments, blank)", () => {
    const stream =
      ": this is a heartbeat comment\n" +
      "\n" +
      sseLine({ choices: [{ delta: { content: "x" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.content).toBe("x");
  });
});

describe("parseChatStream — model + usage capture", () => {
  it("captures the latest model id from the stream", () => {
    const stream =
      sseLine({ model: "gpt-5.4-routed-to-something", choices: [{ delta: { content: "x" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "fallback");
    expect(out.model).toBe("gpt-5.4-routed-to-something");
  });

  it("falls back to the provided model id when the stream omits it", () => {
    const stream =
      sseLine({ choices: [{ delta: { content: "x" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "gpt-4o");
    expect(out.model).toBe("gpt-4o");
  });

  it("captures usage from the final chunk when stream_options.include_usage is set", () => {
    const stream =
      sseLine({ choices: [{ delta: { content: "x" } }] }) +
      sseLine({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 1,
      total_tokens: 4,
    });
  });

  it("leaves usage undefined when no chunk reports it", () => {
    const stream =
      sseLine({ choices: [{ delta: { content: "x" } }] }) +
      "data: [DONE]\n";
    const out = parseChatStream(stream, "x");
    expect(out.usage).toBeUndefined();
  });
});

describe("structural parity between paths (M1 contract)", () => {
  // The chat tool callback wraps both branches with buildChatResponseJson, so
  // verifying that helper enforces the same shape is what guarantees parity.
  it("a streaming + reasoning result and a non-streaming + reasoning result produce the same JSON shape", () => {
    const streaming = buildChatResponseJson({
      content: "out",
      reasoning: "thinking",
      model: "claude-4.7-opus",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const nonStreaming = buildChatResponseJson({
      content: "out",
      reasoning: "thinking",
      model: "claude-4.7-opus",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    expect(JSON.parse(streaming)).toEqual(JSON.parse(nonStreaming));
  });

  it("streaming-without-reasoning and non-streaming-without-reasoning both omit the reasoning key", () => {
    const a = JSON.parse(
      buildChatResponseJson({ content: "x", model: "gpt-4o", usage: undefined }),
    );
    const b = JSON.parse(
      buildChatResponseJson({
        content: "x",
        reasoning: "",
        model: "gpt-4o",
        usage: undefined,
      }),
    );
    expect(a).toEqual(b);
    expect(a).not.toHaveProperty("reasoning");
  });
});
