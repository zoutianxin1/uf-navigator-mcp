/**
 * B3 regression test: allowlist must filter the user-facing model list
 * (navigator_list_models, navigator_health_check) WITHOUT hiding models from
 * internal existence probes (getModelById / modelExists / setAlias warning).
 *
 * Setup trick: we don't hit the gateway. We seed models.json and allowlist.json
 * directly via the configured config dir, then call the public API.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setConfigDirOverride } from "../dist/navigator/paths.js";

const ROOT = join(tmpdir(), `uf-navigator-mcp-allowlist-${process.pid}-${Date.now()}`);
setConfigDirOverride(ROOT);
mkdirSync(ROOT, { recursive: true });

const {
  getModelById,
  listModels,
  modelExists,
} = await import("../dist/navigator/modelsCache.js");

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log("PASS", label); }
  else    { fail++; console.log("FAIL", label, "\n  expected:", JSON.stringify(expected), "\n  actual:  ", JSON.stringify(actual)); }
}
function truthy(v, label) {
  if (v) { pass++; console.log("PASS", label); }
  else   { fail++; console.log("FAIL", label); }
}
function falsy(v, label) {
  if (!v) { pass++; console.log("PASS", label); }
  else    { fail++; console.log("FAIL", label); }
}

function seed({ allowlist, models }) {
  writeFileSync(
    join(ROOT, "models.json"),
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
    writeFileSync(join(ROOT, "allowlist.json"), JSON.stringify(allowlist));
  } else {
    // Ensure stale allowlist from a previous case doesn't leak in.
    rmSync(join(ROOT, "allowlist.json"), { force: true });
  }
}

const ALL_MODELS = ["gpt-4o", "gpt-5.4", "claude-4.7-opus", "gemini-3.1-pro"];

// ── Case 1: no allowlist file → everything visible ────────────────────────────
seed({ models: ALL_MODELS });
{
  const list = await listModels({ use_cache: true });
  eq(list.length, 4, "no allowlist → list returns all models");
  truthy(await modelExists("gemini-3.1-pro"), "no allowlist → modelExists true");
}

// ── Case 2: allowlist excludes gemini — user-facing list filters it out ────────
seed({ models: ALL_MODELS, allowlist: ["gpt-4o", "gpt-5.4", "claude-4.7-opus"] });
{
  const userFacing = await listModels({ use_cache: true });
  eq(userFacing.map((m) => m.id).sort(), ["claude-4.7-opus", "gpt-4o", "gpt-5.4"], "allowlist filters user-facing list");
}

// ── Case 3 (the B3 regression): modelExists for a NON-allowlisted but really-existing model must be TRUE ──
seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
{
  truthy(await modelExists("gemini-3.1-pro"), "B3 FIX: modelExists true for real-but-not-allowlisted");
  truthy(await modelExists("gpt-4o"), "modelExists true for allowlisted");
  falsy(await modelExists("nonexistent-model"), "modelExists false for genuinely missing");

  const m = await getModelById("claude-4.7-opus");
  truthy(m, "B3 FIX: getModelById returns non-allowlisted but real model");
}

// ── Case 4: explicit opt-in to allowlist via listModels flag ─────────────────
seed({ models: ALL_MODELS, allowlist: ["gpt-4o"] });
{
  const unfiltered = await listModels({ use_cache: true, apply_allowlist: false });
  eq(unfiltered.length, 4, "apply_allowlist:false returns full catalog");
  const filtered = await listModels({ use_cache: true, apply_allowlist: true });
  eq(filtered.length, 1, "apply_allowlist:true returns filtered");
}

// ── Cleanup ──────────────────────────────────────────────────────────────────
rmSync(ROOT, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
