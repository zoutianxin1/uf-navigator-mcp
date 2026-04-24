/**
 * Thinking / reasoning effort configuration for UF NaviGator.
 *
 * The UF NaviGator gateway (LiteLLM behind an OpenAI-compatible API) accepts
 * `reasoning_effort` at the top level of the chat-completions body and maps
 * it to each provider's native shape. Valid vocabularies differ per family
 * and, for Anthropic, per model version.
 */

export type ProviderFamily = "openai" | "anthropic" | "google" | "other";

const OPENAI_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const GEMINI_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "disable",
]);
// Anthropic: per-model. Opus 4.7 is the only model that accepts "xhigh".
const ANTHROPIC_EFFORTS_47 = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const ANTHROPIC_EFFORTS_46 = new Set(["low", "medium", "high", "max"]);
// Older Claude (4.5 and earlier) don't expose "xhigh" or "max".
const ANTHROPIC_EFFORTS_OLDER = new Set(["low", "medium", "high"]);

export function detectFamily(modelId: string): ProviderFamily {
  const id = modelId.toLowerCase();
  if (id.includes("claude")) return "anthropic";
  if (id.includes("gpt") || id.startsWith("o1") || id.startsWith("o3"))
    return "openai";
  if (id.includes("gemini")) return "google";
  return "other";
}

function isOpus47(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("4.7") || id.includes("4-7");
}

function isClaude46(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("4.6") || id.includes("4-6");
}

function anthropicAllowedFor(modelId: string): Set<string> {
  if (isOpus47(modelId)) return ANTHROPIC_EFFORTS_47;
  if (isClaude46(modelId)) return ANTHROPIC_EFFORTS_46;
  return ANTHROPIC_EFFORTS_OLDER;
}

/**
 * Default effort per family, per user preference:
 *   OpenAI    → xhigh
 *   Gemini    → high
 *   Claude 4.7 → xhigh
 *   Older Claude → high
 *   Other     → (no default — leave the field unset)
 */
export function defaultEffortFor(modelId: string): string | undefined {
  const fam = detectFamily(modelId);
  if (fam === "openai") return "xhigh";
  if (fam === "google") return "high";
  if (fam === "anthropic") return isOpus47(modelId) ? "xhigh" : "high";
  return undefined;
}

/**
 * Mutate `body` to set reasoning effort for the given model.
 * Throws a human-readable Error on invalid values for known families.
 * For the "other" family, the value is passed through without validation.
 */
export function applyThinkingEffort(
  body: Record<string, unknown>,
  modelId: string,
  effort: string,
): void {
  const fam = detectFamily(modelId);
  const v = effort.toLowerCase();

  if (fam === "openai") {
    if (!OPENAI_EFFORTS.has(v)) {
      throw new Error(
        `Invalid thinking_effort "${effort}" for OpenAI model "${modelId}". Allowed: low, medium, high, xhigh.`,
      );
    }
  } else if (fam === "google") {
    if (!GEMINI_EFFORTS.has(v)) {
      throw new Error(
        `Invalid thinking_effort "${effort}" for Gemini model "${modelId}". Allowed: none, minimal, low, medium, high, disable.`,
      );
    }
  } else if (fam === "anthropic") {
    const allowed = anthropicAllowedFor(modelId);
    if (!allowed.has(v)) {
      const list = [...allowed].join(", ");
      throw new Error(
        `Invalid thinking_effort "${effort}" for Anthropic model "${modelId}". Allowed: ${list}.`,
      );
    }
  }
  // All families (including "other"): set the OpenAI-compat field.
  // LiteLLM normalizes to each provider's native shape.
  body.reasoning_effort = v;
}
