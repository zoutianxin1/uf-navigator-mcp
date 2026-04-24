/**
 * Thinking / reasoning effort configuration for UF NaviGator.
 *
 * The UF NaviGator gateway (LiteLLM behind an OpenAI-compatible API) accepts
 * `reasoning_effort` at the top level of the chat-completions body for most
 * models and maps it to each provider's native shape. Claude 4.7 via Bedrock
 * is special: the gateway rejects the translated `thinking.type.enabled`
 * shape and requires `output_config.effort` instead, so this module also
 * routes the effort value to the right body field per model.
 *
 * Runtime authority for a model's default effort + allowed vocabulary lives
 * in the per-model file `{configDir}/model_configs/{safeId}.json` managed by
 * `modelConfigs.ts`. The family/version vocabulary tables in this module are
 * INTERNAL BOOTSTRAP ONLY — used to seed a fresh per-model file on first
 * encounter and to provide the first-time-prompt options. Once the file
 * exists, it is authoritative; users can hand-edit it to adapt to future
 * gateway changes without code changes.
 */

import {
  readModelConfig,
  ThinkingSection,
  updateThinkingSection,
} from "./modelConfigs.js";

export type ProviderFamily = "openai" | "anthropic" | "google" | "other";

// ── Sentinel ──────────────────────────────────────────────────────────────────

/** Used in a model's `default_effort` to indicate the model does not support reasoning_effort. */
export const NOT_APPLICABLE = "not_applicable";

// ── BOOTSTRAP-ONLY vocabularies ───────────────────────────────────────────────
// These family/version tables seed a per-model file when one doesn't yet
// exist. They are NOT the runtime source of truth — per-model files are.

const OPENAI_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const GEMINI_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "disable",
] as const;
// Anthropic: per-model-version.
const ANTHROPIC_EFFORTS_47 = ["low", "medium", "high", "xhigh", "max"] as const;
const ANTHROPIC_EFFORTS_46 = ["low", "medium", "high", "max"] as const;
const ANTHROPIC_EFFORTS_OLDER = ["low", "medium", "high"] as const;

// ── Family + version detection (BOOTSTRAP ONLY) ───────────────────────────────

export function detectFamily(modelId: string): ProviderFamily {
  const id = modelId.toLowerCase();
  if (id.includes("claude")) return "anthropic";
  if (id.includes("gpt") || /(?:^|[/_-])o[13](?:[-_]|$)/.test(id))
    return "openai";
  if (id.includes("gemini")) return "google";
  return "other";
}

function isClaude47(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("claude") && /(4\.7|4-7)/.test(id);
}

function isClaude46(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("claude") && /(4\.6|4-6)/.test(id);
}

function anthropicAllowedFor(modelId: string): readonly string[] {
  if (isClaude47(modelId)) return ANTHROPIC_EFFORTS_47;
  if (isClaude46(modelId)) return ANTHROPIC_EFFORTS_46;
  return ANTHROPIC_EFFORTS_OLDER;
}

// ── Narrow seeds (status-quo defaults, BOOTSTRAP ONLY) ────────────────────────
// Only these three patterns get an automatic default. Anything else falls
// through to the first-time prompt.

const SEED_GPT5 = /(?:^|[^0-9])gpt-?5(?:[.-]\d+)?/i;
// Opus 4.7 only — not Sonnet 4.7 or Haiku 4.7 (their effort vocabularies may
// differ; let the user make the call on first use).
const SEED_OPUS47 = /(?=.*opus)(?=.*4(?:\.|-)7)/i;
const SEED_GEMINI3 = /gemini[-\s]?3(?:[.-]\d+)?/i;

export function defaultEffortFor(modelId: string): string | undefined {
  const id = modelId.toLowerCase();
  if (SEED_GPT5.test(id)) return "xhigh";
  if (SEED_OPUS47.test(id)) return "xhigh";
  if (SEED_GEMINI3.test(id)) return "high";
  return undefined;
}

/** Ordered vocabulary for a model, used when seeding `allowed_efforts` on a fresh file. */
export function allowedEffortsFor(modelId: string): string[] {
  const fam = detectFamily(modelId);
  if (fam === "openai") return [...OPENAI_EFFORTS];
  if (fam === "google") return [...GEMINI_EFFORTS];
  if (fam === "anthropic") return [...anthropicAllowedFor(modelId)];
  return []; // "other" — pass-through; no canonical list
}

/** Where to put the effort value in the outgoing request body, by model. */
export function effortFieldFor(
  modelId: string,
): "reasoning_effort" | "output_config.effort" {
  // Claude 4.7 on Bedrock requires output_config.effort; LiteLLM's
  // `reasoning_effort → thinking.type.enabled` translation is rejected.
  if (isClaude47(modelId)) return "output_config.effort";
  return "reasoning_effort";
}

// ── First-time prompt: non-reasoning-model ID heuristic ───────────────────────

const NOT_APPLICABLE_HINTS: Array<[RegExp, string]> = [
  [/embed|embedding|ada/i, "embedding model"],
  [/whisper|stt|speech-to-text/i, "speech-to-text model"],
  [/tts|kokoro|text-to-speech/i, "text-to-speech model"],
  [/dall-?e|image|stable-?diffusion|(?:^|[^a-z])sd(?:[^a-z]|$)/i, "image-generation model"],
];

export function suggestDefault(
  modelId: string,
): { value: string; reason: string } | undefined {
  for (const [re, reason] of NOT_APPLICABLE_HINTS) {
    if (re.test(modelId)) return { value: NOT_APPLICABLE, reason };
  }
  return undefined;
}

// ── Apply to request body ─────────────────────────────────────────────────────

/**
 * Set the effort on a request body. The caller supplies the field because the
 * choice is per-model (see `effortFieldFor` / per-model-file `effort_field`).
 *
 * `reasoning_effort` → top-level string.
 * `output_config.effort` → nested object (merging with any existing output_config).
 *
 * Throws on unknown field strings.
 */
export function applyThinkingEffort(
  body: Record<string, unknown>,
  effort: string,
  field: "reasoning_effort" | "output_config.effort",
): void {
  const v = effort.toLowerCase();
  if (field === "reasoning_effort") {
    body.reasoning_effort = v;
    return;
  }
  if (field === "output_config.effort") {
    const existing = (body.output_config as Record<string, unknown> | undefined) ?? {};
    body.output_config = { ...existing, effort: v };
    return;
  }
  throw new Error(`Unknown effort_field "${field}".`);
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateEffortForModel(modelId: string, effort: string): void {
  if (effort === NOT_APPLICABLE) return;
  const v = effort.toLowerCase();

  // Per-model file wins if it has a non-empty vocabulary. An empty
  // allowed_efforts (e.g. the user stored `not_applicable`) means the file
  // has nothing to validate against — fall through to bootstrap so explicit
  // overrides are still sanity-checked against the family vocabulary.
  const config = readModelConfig(modelId);
  const fileAllowed = config?.thinking?.allowed_efforts;
  if (fileAllowed && fileAllowed.length > 0) {
    if (!fileAllowed.includes(v)) {
      throw new Error(
        `Invalid thinking_effort "${effort}" for model "${modelId}". ` +
          `Allowed: ${fileAllowed.join(", ")}.`,
      );
    }
    return;
  }

  // Fall back to bootstrap vocabulary.
  const bootstrap = allowedEffortsFor(modelId);
  if (bootstrap.length > 0 && !bootstrap.includes(v)) {
    throw new Error(
      `Invalid thinking_effort "${effort}" for model "${modelId}". ` +
        `Allowed: ${bootstrap.join(", ")}.`,
    );
  }
  // "other" family or empty vocab → pass-through (gateway will decide).
}

// ── Top-level resolution used by navigator_chat ───────────────────────────────

export type ThinkingResolution =
  | {
      kind: "apply";
      effort: string;
      field: "reasoning_effort" | "output_config.effort";
    }
  | { kind: "skip" }
  | {
      kind: "prompt";
      model: string;
      allowed: string[];
      suggested?: { value: string; reason: string };
    };

/**
 * Tiered resolution:
 *   1. Explicit arg wins (validated against file or bootstrap).
 *      "not_applicable" as explicit → skip.
 *   2. Per-model file → apply its default (or skip if not_applicable).
 *   3. Narrow seed → auto-materialise per-model file, then apply.
 *   4. Otherwise → prompt (no gateway call; no file written).
 */
export function resolveThinkingEffort(
  modelId: string,
  explicit?: string,
): ThinkingResolution {
  // Tier 1: explicit
  if (explicit !== undefined) {
    if (explicit.toLowerCase() === NOT_APPLICABLE) {
      return { kind: "skip" };
    }
    validateEffortForModel(modelId, explicit);
    return {
      kind: "apply",
      effort: explicit.toLowerCase(),
      field: effortFieldFor(modelId),
    };
  }

  // Tier 2: per-model file
  const config = readModelConfig(modelId);
  const stored = config?.thinking;
  if (stored) {
    if (stored.default_effort === NOT_APPLICABLE) return { kind: "skip" };
    if (stored.effort_field === null) return { kind: "skip" };
    return {
      kind: "apply",
      effort: stored.default_effort,
      field: stored.effort_field,
    };
  }

  // Tier 3: seed auto-materialisation
  const seed = defaultEffortFor(modelId);
  if (seed !== undefined) {
    const section: ThinkingSection = {
      default_effort: seed,
      allowed_efforts: allowedEffortsFor(modelId),
      effort_field: effortFieldFor(modelId),
    };
    try {
      updateThinkingSection(modelId, section);
      process.stderr.write(
        `[uf-navigator] Seeded thinking default for "${modelId}": ${seed} via ${section.effort_field}\n`,
      );
    } catch (err) {
      process.stderr.write(
        `[uf-navigator] Warning: failed to persist seeded default for "${modelId}": ${String(err)}\n`,
      );
    }
    return {
      kind: "apply",
      effort: seed,
      field: section.effort_field as "reasoning_effort" | "output_config.effort",
    };
  }

  // Tier 4: prompt
  return {
    kind: "prompt",
    model: modelId,
    allowed: allowedEffortsFor(modelId),
    suggested: suggestDefault(modelId),
  };
}

// ── First-time-prompt payload ─────────────────────────────────────────────────

/**
 * Human-readable explanation + a bounded, stable-schema JSON block that
 * agents can parse. Payload aims for ≤ 600 bytes total; the JSON block is
 * emitted with fixed key order (`model, allowed, suggested`) for snapshot
 * stability.
 */
export function buildDecisionRequiredText(
  r: Extract<ThinkingResolution, { kind: "prompt" }>,
): string {
  const suggestedLine = r.suggested
    ? `\nSuggested:       ${r.suggested.value} (${r.suggested.reason})`
    : "";
  const ctx: { model: string; allowed: string[]; suggested: { value: string; reason: string } | null } = {
    model: r.model,
    allowed: r.allowed,
    suggested: r.suggested ?? null,
  };
  // Stable stringification via explicit key order.
  const json =
    `{"model":${JSON.stringify(ctx.model)},` +
    `"allowed":${JSON.stringify(ctx.allowed)},` +
    `"suggested":${JSON.stringify(ctx.suggested)}}`;

  return (
    `THINKING_EFFORT_DECISION_REQUIRED for model "${r.model}".\n` +
    `\n` +
    `First time this model has been used via navigator_chat. Pick a default so\n` +
    `reasoning_effort isn't force-injected into a model that doesn't support it.\n` +
    `\n` +
    `Allowed efforts: ${r.allowed.length ? r.allowed.join(", ") : "(none; pass-through)"}` +
    suggestedLine +
    `\n\n` +
    `Options:\n` +
    `  - navigator_manage_thinking_defaults({ action: "configure", model_or_alias, value })\n` +
    `      where value is one of the allowed efforts, or "not_applicable".\n` +
    `  - OR pass thinking_effort="<effort>" on the next call to bypass for one call.\n` +
    `\n` +
    `No request was sent to the gateway.\n` +
    `\n` +
    `<decision-context>${json}</decision-context>`
  );
}
