import {
  allowedEffortsFor,
  applyThinkingEffort,
  defaultEffortFor,
  detectFamily,
  effortFieldFor,
  suggestDefault,
} from "../dist/navigator/thinking.js";

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log("PASS", label); }
  else    { fail++; console.log("FAIL", label, "\n  expected:", expected, "\n  actual:  ", actual); }
}
function throws(fn, label) {
  try { fn(); fail++; console.log("FAIL", label, "(did not throw)"); }
  catch (e) { pass++; console.log("PASS", label, "->", e.message); }
}

// ── detectFamily ──────────────────────────────────────────────────────────────
eq(detectFamily("gpt-5.4"), "openai", "detect gpt-5.4");
eq(detectFamily("gpt-4o"), "openai", "detect gpt-4o");
eq(detectFamily("o1-mini"), "openai", "detect o1-mini");
eq(detectFamily("o3-mini"), "openai", "detect o3-mini");
eq(detectFamily("claude-4.7-opus"), "anthropic", "detect claude-4.7-opus");
eq(detectFamily("claude-4.6-sonnet"), "anthropic", "detect claude-4.6-sonnet");
eq(detectFamily("gemini-3.1-pro"), "google", "detect gemini-3.1-pro");
eq(detectFamily("text-embedding-3-large"), "other", "detect embedding as other");
eq(detectFamily("whisper-1"), "other", "detect whisper as other");

// ── defaultEffortFor (NARROWED to gpt-5.X / opus-4.7 / gemini-3.X) ────────────
eq(defaultEffortFor("gpt-5.4"), "xhigh", "seed: gpt-5.4 → xhigh");
eq(defaultEffortFor("gpt-5"), "xhigh", "seed: gpt-5 → xhigh");
eq(defaultEffortFor("gemini-3.1-pro"), "high", "seed: gemini-3.1-pro → high");
eq(defaultEffortFor("gemini-3"), "high", "seed: gemini-3 → high");
eq(defaultEffortFor("claude-4.7-opus"), "xhigh", "seed: claude-4.7-opus → xhigh");

// Narrowed away:
eq(defaultEffortFor("gpt-4o"), undefined, "narrowed: no seed for gpt-4o");
eq(defaultEffortFor("gpt-4-turbo"), undefined, "narrowed: no seed for gpt-4-turbo");
eq(defaultEffortFor("o1-mini"), undefined, "narrowed: no seed for o1-mini");
eq(defaultEffortFor("o3-mini"), undefined, "narrowed: no seed for o3-mini");
eq(defaultEffortFor("claude-4.7-sonnet"), undefined, "narrowed: opus-4.7 only, not sonnet-4.7");
eq(defaultEffortFor("claude-4.7-haiku"), undefined, "narrowed: opus-4.7 only, not haiku-4.7");
eq(defaultEffortFor("claude-4.6-opus"), undefined, "narrowed: no seed for claude 4.6");
eq(defaultEffortFor("claude-4.5-opus"), undefined, "narrowed: no seed for claude 4.5");
eq(defaultEffortFor("gemini-2.5-pro"), undefined, "narrowed: no seed for gemini 2.5");
eq(defaultEffortFor("text-embedding-3-large"), undefined, "no seed for embeddings");
eq(defaultEffortFor("some-weird-model"), undefined, "no seed for other");

// ── allowedEffortsFor ─────────────────────────────────────────────────────────
eq(allowedEffortsFor("gpt-5.4"), ["low", "medium", "high", "xhigh"], "openai vocab");
eq(allowedEffortsFor("gemini-3.1-pro"), ["none", "minimal", "low", "medium", "high", "disable"], "gemini vocab");
eq(allowedEffortsFor("claude-4.7-opus"), ["low", "medium", "high", "xhigh", "max"], "anthropic 4.7 vocab");
eq(allowedEffortsFor("claude-4.6-opus"), ["low", "medium", "high", "max"], "anthropic 4.6 vocab");
eq(allowedEffortsFor("claude-4.5-opus"), ["low", "medium", "high"], "anthropic older vocab");
eq(allowedEffortsFor("text-embedding-3-large"), [], "empty vocab for 'other'");

// ── effortFieldFor (KEY FIX for Claude-4.7 gateway issue) ─────────────────────
eq(effortFieldFor("claude-4.7-opus"), "output_config.effort", "claude-4.7 uses output_config.effort");
eq(effortFieldFor("claude-4.7-sonnet"), "output_config.effort", "claude-4.7 sonnet uses output_config.effort");
eq(effortFieldFor("claude-4.6-opus"), "reasoning_effort", "claude-4.6 uses reasoning_effort");
eq(effortFieldFor("claude-3.5-sonnet"), "reasoning_effort", "older claude uses reasoning_effort");
eq(effortFieldFor("gpt-5.4"), "reasoning_effort", "openai uses reasoning_effort");
eq(effortFieldFor("gemini-3.1-pro"), "reasoning_effort", "gemini uses reasoning_effort");

// ── applyThinkingEffort (refactored signature: body, effort, field) ───────────
let body;

body = {}; applyThinkingEffort(body, "xhigh", "reasoning_effort");
eq(body, { reasoning_effort: "xhigh" }, "apply reasoning_effort field");

body = {}; applyThinkingEffort(body, "xhigh", "output_config.effort");
eq(body, { output_config: { effort: "xhigh" } }, "apply output_config.effort field");

body = { output_config: { adaptive: true } };
applyThinkingEffort(body, "max", "output_config.effort");
eq(body, { output_config: { adaptive: true, effort: "max" } }, "merge into existing output_config");

body = {}; applyThinkingEffort(body, "HIGH", "reasoning_effort");
eq(body, { reasoning_effort: "high" }, "lowercase normalization");

throws(() => applyThinkingEffort({}, "xhigh", "bogus"), "throws on unknown field");

// ── suggestDefault (non-reasoning model ID heuristic) ─────────────────────────
eq(suggestDefault("text-embedding-3-large"), { value: "not_applicable", reason: "embedding model" }, "suggest for embedding");
eq(suggestDefault("whisper-1"), { value: "not_applicable", reason: "speech-to-text model" }, "suggest for whisper");
eq(suggestDefault("kokoro-v1"), { value: "not_applicable", reason: "text-to-speech model" }, "suggest for tts");
eq(suggestDefault("dall-e-3"), { value: "not_applicable", reason: "image-generation model" }, "suggest for dall-e");
eq(suggestDefault("gpt-5.4"), undefined, "no suggestion for reasoning model");
eq(suggestDefault("claude-4.7-opus"), undefined, "no suggestion for Claude");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
