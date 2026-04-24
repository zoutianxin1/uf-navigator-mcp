import { applyThinkingEffort, defaultEffortFor, detectFamily } from "../dist/navigator/thinking.js";

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

// detectFamily
eq(detectFamily("gpt-5.4"), "openai", "detect gpt-5.4");
eq(detectFamily("claude-4.7-opus"), "anthropic", "detect claude-4.7-opus");
eq(detectFamily("claude-4.6-sonnet"), "anthropic", "detect claude-4.6-sonnet");
eq(detectFamily("gemini-3.1-pro"), "google", "detect gemini-3.1-pro");
eq(detectFamily("some-weird-model"), "other", "detect other");

// defaults
eq(defaultEffortFor("gpt-5.4"), "xhigh", "default gpt-5.4 = xhigh");
eq(defaultEffortFor("gemini-3.1-pro"), "high", "default gemini = high");
eq(defaultEffortFor("claude-4.7-opus"), "xhigh", "default claude-4.7-opus = xhigh");
eq(defaultEffortFor("claude-4.6-opus"), "high", "default claude-4.6-opus = high");
eq(defaultEffortFor("claude-4.5-opus"), "high", "default older claude = high");
eq(defaultEffortFor("some-weird-model"), undefined, "default other = undefined");

// valid applies
let body;
body = {}; applyThinkingEffort(body, "gpt-5.4", "xhigh");
eq(body, { reasoning_effort: "xhigh" }, "gpt-5.4 + xhigh");

body = {}; applyThinkingEffort(body, "gemini-3.1-pro", "disable");
eq(body, { reasoning_effort: "disable" }, "gemini + disable");

body = {}; applyThinkingEffort(body, "claude-4.7-opus", "xhigh");
eq(body, { reasoning_effort: "xhigh" }, "claude-4.7-opus + xhigh");

body = {}; applyThinkingEffort(body, "claude-4.7-opus", "max");
eq(body, { reasoning_effort: "max" }, "claude-4.7-opus + max");

body = {}; applyThinkingEffort(body, "claude-4.6-opus", "max");
eq(body, { reasoning_effort: "max" }, "claude-4.6-opus + max");

// invalid throws
throws(() => applyThinkingEffort({}, "gpt-5.4", "banana"), "gpt-5.4 + banana -> throw");
throws(() => applyThinkingEffort({}, "gemini-3.1-pro", "xhigh"), "gemini + xhigh -> throw");
throws(() => applyThinkingEffort({}, "claude-4.6-opus", "xhigh"), "claude-4.6-opus + xhigh -> throw");
throws(() => applyThinkingEffort({}, "claude-4.5-opus", "max"), "older claude + max -> throw");

// unknown family passes through without validation
body = {}; applyThinkingEffort(body, "some-weird-model", "whatever");
eq(body, { reasoning_effort: "whatever" }, "other family passes through");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
