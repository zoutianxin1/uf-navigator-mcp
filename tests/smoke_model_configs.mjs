import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setConfigDirOverride } from "../dist/navigator/paths.js";

// Point every module-under-test at a fresh tmp dir BEFORE importing anything
// that touches the filesystem through getConfigDir().
const ROOT = join(tmpdir(), `uf-navigator-mcp-test-${process.pid}-${Date.now()}`);
setConfigDirOverride(ROOT);
mkdirSync(ROOT, { recursive: true });

// Dynamic imports so the override above is live when these modules load.
const {
  deleteModelConfig,
  listModelConfigs,
  readModelConfig,
  updateThinkingSection,
  writeModelConfig,
} = await import("../dist/navigator/modelConfigs.js");
const {
  buildDecisionRequiredText,
  resolveThinkingEffort,
} = await import("../dist/navigator/thinking.js");

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log("PASS", label); }
  else    { fail++; console.log("FAIL", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
}
function truthy(v, label) {
  if (v) { pass++; console.log("PASS", label); }
  else   { fail++; console.log("FAIL", label, "(falsy:", JSON.stringify(v), ")"); }
}

function cleanDir() {
  rmSync(join(ROOT, "model_configs"), { recursive: true, force: true });
}

// ── Empty dir ─────────────────────────────────────────────────────────────────
cleanDir();
eq(listModelConfigs(), { configs: [], skipped_unreadable: 0 }, "empty dir → empty list");
eq(readModelConfig("gpt-4o"), null, "empty dir → read null");

// ── Round-trip write + read ───────────────────────────────────────────────────
cleanDir();
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
truthy(rt, "round-trip read returns file");
eq(rt.model_id, "gpt-4o", "model_id preserved (lowercased)");
eq(rt.thinking.default_effort, "not_applicable", "thinking section preserved");
truthy(rt.updated_at !== "2000-01-01T00:00:00.000Z", "updated_at was re-stamped on write");

// ── Corruption tolerance ──────────────────────────────────────────────────────
cleanDir();
mkdirSync(join(ROOT, "model_configs"), { recursive: true });
writeFileSync(join(ROOT, "model_configs", "garbage.json"), "not-json{{{", "utf8");
eq(readModelConfig("garbage"), null, "corrupt file → read null");
const listResult = listModelConfigs();
eq(listResult.configs.length, 0, "corrupt file excluded from list");
eq(listResult.skipped_unreadable, 1, "corrupt file counted in skipped");

// Also: valid JSON but wrong shape.
writeFileSync(join(ROOT, "model_configs", "badshape.json"), JSON.stringify({ foo: "bar" }), "utf8");
eq(readModelConfig("badshape"), null, "wrong-shape → read null");
eq(listModelConfigs().skipped_unreadable, 2, "wrong-shape counted in skipped");

// ── Seed auto-materialisation (gpt-5.X → xhigh / reasoning_effort) ────────────
cleanDir();
const r1 = resolveThinkingEffort("gpt-5.4");
eq(r1, { kind: "apply", effort: "xhigh", field: "reasoning_effort" }, "gpt-5.4 seed resolves to xhigh via reasoning_effort");
const f1 = readModelConfig("gpt-5.4");
truthy(f1, "gpt-5.4 per-model file auto-materialized");
eq(f1.thinking.default_effort, "xhigh", "seeded default_effort=xhigh");
eq(f1.thinking.effort_field, "reasoning_effort", "seeded effort_field");

// ── Seed auto-materialisation (claude-4.7-opus → xhigh / output_config.effort) ─
cleanDir();
const r2 = resolveThinkingEffort("claude-4.7-opus");
eq(r2, { kind: "apply", effort: "xhigh", field: "output_config.effort" }, "claude-4.7-opus seed → output_config.effort (fixes gateway 400)");
const f2 = readModelConfig("claude-4.7-opus");
eq(f2.thinking.effort_field, "output_config.effort", "seeded claude-4.7 with output_config.effort");

// ── Prompt path (no file, no seed) ────────────────────────────────────────────
cleanDir();
const r3 = resolveThinkingEffort("gpt-4o");
eq(r3.kind, "prompt", "gpt-4o → prompt");
eq(r3.allowed, ["low", "medium", "high", "xhigh"], "prompt has openai vocab");
eq(r3.suggested, undefined, "no suggestion for gpt-4o (it's a chat model)");
eq(readModelConfig("gpt-4o"), null, "prompt path does NOT write a file");

// ── Prompt path with suggestion ───────────────────────────────────────────────
cleanDir();
const r4 = resolveThinkingEffort("text-embedding-3-large");
eq(r4.kind, "prompt", "embedding → prompt");
eq(r4.suggested.value, "not_applicable", "embedding pre-suggested not_applicable");

// ── Stored not_applicable → skip ──────────────────────────────────────────────
cleanDir();
updateThinkingSection("gpt-4o", {
  default_effort: "not_applicable",
  allowed_efforts: [],
  effort_field: null,
});
const r5 = resolveThinkingEffort("gpt-4o");
eq(r5, { kind: "skip" }, "stored not_applicable → skip");

// ── Stored effort → apply ─────────────────────────────────────────────────────
cleanDir();
updateThinkingSection("gpt-4o", {
  default_effort: "high",
  allowed_efforts: ["low", "medium", "high", "xhigh"],
  effort_field: "reasoning_effort",
});
const r6 = resolveThinkingEffort("gpt-4o");
eq(r6, { kind: "apply", effort: "high", field: "reasoning_effort" }, "stored 'high' → apply");

// ── Explicit arg beats file (even when file says not_applicable) ──────────────
cleanDir();
updateThinkingSection("gpt-4o", {
  default_effort: "not_applicable",
  allowed_efforts: [],
  effort_field: null,
});
const r7 = resolveThinkingEffort("gpt-4o", "high");
eq(r7, { kind: "apply", effort: "high", field: "reasoning_effort" }, "explicit 'high' beats file's not_applicable");

// Explicit "not_applicable" → skip.
const r8 = resolveThinkingEffort("gpt-5.4", "not_applicable");
eq(r8, { kind: "skip" }, "explicit not_applicable → skip (even on seeded model)");

// Explicit invalid → throws.
try {
  resolveThinkingEffort("gpt-4o", "banana");
  fail++; console.log("FAIL explicit banana should throw");
} catch (e) {
  pass++; console.log("PASS explicit banana throws:", e.message);
}

// ── Delete section (collapsing + preserving) ──────────────────────────────────
cleanDir();
updateThinkingSection("gpt-4o", {
  default_effort: "high",
  allowed_efforts: ["low", "medium", "high", "xhigh"],
  effort_field: "reasoning_effort",
});
truthy(readModelConfig("gpt-4o"), "file exists after configure");
updateThinkingSection("gpt-4o", null);
eq(readModelConfig("gpt-4o"), null, "removing only-section collapses whole file");

// Unknown-section preservation: hand-write a file with both thinking + vision,
// delete only thinking, verify vision survives.
cleanDir();
mkdirSync(join(ROOT, "model_configs"), { recursive: true });
writeFileSync(
  join(ROOT, "model_configs", "claude-4.7-opus.json"),
  JSON.stringify({
    model_id: "claude-4.7-opus",
    updated_at: "2026-01-01T00:00:00.000Z",
    thinking: {
      default_effort: "xhigh",
      allowed_efforts: ["low", "medium", "high", "xhigh", "max"],
      effort_field: "output_config.effort",
    },
    vision: { placeholder: "future" },
  }, null, 2),
  "utf8",
);
// Configure-then-read preserves vision.
updateThinkingSection("claude-4.7-opus", {
  default_effort: "high",
  allowed_efforts: ["low", "medium", "high", "xhigh", "max"],
  effort_field: "output_config.effort",
});
const preserved = readModelConfig("claude-4.7-opus");
eq(preserved.vision, { placeholder: "future" }, "unknown vision section preserved through configure");
eq(preserved.thinking.default_effort, "high", "thinking section updated");

// Delete thinking while vision exists → file survives.
updateThinkingSection("claude-4.7-opus", null);
const afterDelete = readModelConfig("claude-4.7-opus");
truthy(afterDelete, "file survives when sibling section remains");
eq(afterDelete.thinking, undefined, "thinking removed");
eq(afterDelete.vision, { placeholder: "future" }, "vision still preserved");

// ── Bounded, stable-schema decision-required payload ──────────────────────────
const payload = buildDecisionRequiredText({
  kind: "prompt",
  model: "gpt-4o",
  allowed: ["low", "medium", "high", "xhigh"],
  suggested: undefined,
});
truthy(payload.includes("THINKING_EFFORT_DECISION_REQUIRED"), "payload has header");
truthy(payload.includes("<decision-context>"), "payload has decision-context block");
truthy(payload.length < 800, `payload bounded (len=${payload.length} < 800)`);

// Stable JSON key order inside the block.
const ctxMatch = payload.match(/<decision-context>(.+)<\/decision-context>/);
truthy(ctxMatch, "can extract decision-context");
const ctxStr = ctxMatch[1];
truthy(
  ctxStr.indexOf('"model"') < ctxStr.indexOf('"allowed"') &&
    ctxStr.indexOf('"allowed"') < ctxStr.indexOf('"suggested"'),
  "decision-context JSON key order is model → allowed → suggested"
);

// Suggested block appears when provided.
const payloadSuggested = buildDecisionRequiredText({
  kind: "prompt",
  model: "text-embedding-3-large",
  allowed: [],
  suggested: { value: "not_applicable", reason: "embedding model" },
});
truthy(payloadSuggested.includes("Suggested:"), "payload shows Suggested line when present");

// ── Listing ───────────────────────────────────────────────────────────────────
cleanDir();
resolveThinkingEffort("gpt-5.4");  // auto-materializes
resolveThinkingEffort("claude-4.7-opus");  // auto-materializes
const listed = listModelConfigs();
eq(listed.configs.length, 2, "list shows two seeded files");
eq(listed.skipped_unreadable, 0, "no skips in listing");

// ── Delete whole config ───────────────────────────────────────────────────────
cleanDir();
resolveThinkingEffort("gpt-5.4");
truthy(readModelConfig("gpt-5.4"), "file exists pre-delete");
eq(deleteModelConfig("gpt-5.4"), true, "delete returns true");
eq(readModelConfig("gpt-5.4"), null, "file gone after delete");
eq(deleteModelConfig("gpt-5.4"), false, "second delete returns false");

// ── Cleanup ───────────────────────────────────────────────────────────────────
rmSync(ROOT, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
