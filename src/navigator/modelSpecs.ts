import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveModel } from "./aliases.js";
import { atomicWriteFileSync } from "./fileUtils.js";
import { listModels } from "./modelsCache.js";
import { getConfigDir } from "./paths.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelSpec {
  modelId: string;
  contextLength?: number;
  modalities?: string[];
  pricing?: Record<string, string>;
  trainingCutoff?: string;
  classification?: string;
  whenToUse?: string;
  sourceUrl?: string;
  fetchedAt: string;
  raw?: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const CONFIG_DIR = getConfigDir();
const SPECS_DIR = join(CONFIG_DIR, "specs");
const SPEC_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function ensureSpecsDir(): void {
  mkdirSync(SPECS_DIR, { recursive: true });
}

function specPath(modelId: string): string {
  // Replace slashes and colons to create safe filenames
  const safe = modelId.replace(/[/\\:*?"<>|]/g, "_");
  return join(SPECS_DIR, `${safe}.json`);
}

function readSpecCache(modelId: string): ModelSpec | null {
  const p = specPath(modelId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ModelSpec;
  } catch {
    return null;
  }
}

function writeSpecCache(spec: ModelSpec): void {
  ensureSpecsDir();
  atomicWriteFileSync(specPath(spec.modelId), JSON.stringify(spec, null, 2));
}

function isSpecFresh(spec: ModelSpec): boolean {
  const age = Date.now() - new Date(spec.fetchedAt).getTime();
  return age < SPEC_TTL_MS;
}

// ── HTML parsing ──────────────────────────────────────────────────────────────

/**
 * Very lightweight HTML field extraction — no external parser needed.
 * Looks for common patterns on UF docs model pages.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function parseSpecHtml(html: string, modelId: string, sourceUrl: string): ModelSpec {
  const spec: ModelSpec = {
    modelId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    raw: html.slice(0, 8000), // keep first 8 KB for debugging
  };

  // Work on tag-stripped text so patterns aren't blocked by HTML tags
  const text = stripTags(html);

  // Context length: look for numbers near "context" keyword
  const ctxMatch = text.match(
    /context[^.]{0,80}?(\d[\d,]+)\s*(token|k\b)/i,
  );
  if (ctxMatch) {
    spec.contextLength = parseInt(ctxMatch[1].replace(/,/g, ""), 10);
  }

  // Modalities: look for "text", "image", "audio", "embedding"
  const modalitiesFound: string[] = [];
  if (/\btext\b/i.test(text)) modalitiesFound.push("text");
  if (/\bimage\b/i.test(text)) modalitiesFound.push("image");
  if (/\baudio\b/i.test(text)) modalitiesFound.push("audio");
  if (/\bembedding\b/i.test(text)) modalitiesFound.push("embedding");
  if (modalitiesFound.length) spec.modalities = modalitiesFound;

  // Pricing: look for dollar amounts near "input"/"output"
  const pricingMap: Record<string, string> = {};
  const priceRe = /\$([\d.]+)\s*(?:per|\/)\s*(\d+[MK]?)\s*tokens?\s*(?:for\s*)?(input|output)?/gi;
  let pm: RegExpExecArray | null;
  while ((pm = priceRe.exec(text)) !== null) {
    const label = pm[3] ?? "price";
    pricingMap[label.toLowerCase()] = `$${pm[1]} per ${pm[2]} tokens`;
  }
  if (Object.keys(pricingMap).length) spec.pricing = pricingMap;

  // Training cutoff
  const cutoffMatch = text.match(
    /training\s+(?:data\s+)?cutoff[^.]{0,60}?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4}-\d{2})/i,
  );
  if (cutoffMatch) spec.trainingCutoff = cutoffMatch[1];

  // Classification (UF data types: "Regulated", "Sensitive", "Public", etc.)
  const classMatch = text.match(
    /(?:data\s+)?classification[^.]{0,80}?(Regulated|Sensitive|Public|Restricted|Confidential)/i,
  );
  if (classMatch) spec.classification = classMatch[1];

  // "When to use" blurb — look in stripped text after the heading
  const whenMatch = text.match(
    /when\s+to\s+use\s*[:\-]?\s*(.{20,400})/i,
  );
  if (whenMatch) {
    spec.whenToUse = whenMatch[1].trim().replace(/\s+/g, " ");
  }

  return spec;
}

// ── Doc URL candidates ────────────────────────────────────────────────────────

function docUrlCandidates(modelId: string): string[] {
  const slug = modelId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return [
    `https://docs.ai.it.ufl.edu/docs/models/${modelId}/`,
    `https://docs.ai.it.ufl.edu/docs/models/${slug}/`,
    `https://docs.ai.it.ufl.edu/models/${modelId}/`,
    `https://docs.ai.it.ufl.edu/models/${slug}/`,
  ];
}

async function fetchSpecPage(modelId: string): Promise<{ html: string; url: string } | null> {
  for (const url of docUrlCandidates(modelId)) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "uf-navigator-mcp/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const html = await resp.text();
        return { html, url };
      }
    } catch {
      // Try next URL
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch and cache the spec for a given model or alias. */
export async function getModelSpecs(modelOrAlias: string): Promise<ModelSpec> {
  const { resolvedModel } = resolveModel(modelOrAlias);

  const cached = readSpecCache(resolvedModel);
  if (cached && isSpecFresh(cached)) return cached;

  // Fetch from UF docs
  const result = await fetchSpecPage(resolvedModel);
  if (!result) {
    // Return a minimal spec with just the id if docs page not found
    const minSpec: ModelSpec = {
      modelId: resolvedModel,
      fetchedAt: new Date().toISOString(),
      sourceUrl: undefined,
    };
    writeSpecCache(minSpec);
    return minSpec;
  }

  const spec = parseSpecHtml(result.html, resolvedModel, result.url);
  writeSpecCache(spec);
  return spec;
}

/** Refresh specs for all models in the cache. */
export async function refreshModelIndex(): Promise<{
  processed: number;
  errors: Array<{ modelId: string; error: string }>;
}> {
  const models = await listModels({ use_cache: true });
  const errors: Array<{ modelId: string; error: string }> = [];
  let processed = 0;

  for (const model of models) {
    try {
      await getModelSpecs(model.id);
      processed++;
    } catch (err) {
      errors.push({ modelId: model.id, error: String(err) });
    }
  }

  return { processed, errors };
}
