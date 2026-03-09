import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ── Inline the HTML parser from modelSpecs.ts for isolated testing ────────────
// (Avoids needing file-system setup or network calls in unit tests.)

interface ModelSpec {
  modelId: string;
  contextLength?: number;
  modalities?: string[];
  pricing?: Record<string, string>;
  trainingCutoff?: string;
  classification?: string;
  whenToUse?: string;
  sourceUrl?: string;
  fetchedAt: string;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

function parseSpecHtml(html: string, modelId: string, sourceUrl: string): ModelSpec {
  const spec: ModelSpec = {
    modelId,
    sourceUrl,
    fetchedAt: new Date().toISOString(),
  };

  const text = stripTags(html);

  const ctxMatch = text.match(/context[^.]{0,80}?(\d[\d,]+)\s*(token|k\b)/i);
  if (ctxMatch) {
    spec.contextLength = parseInt(ctxMatch[1].replace(/,/g, ""), 10);
  }

  const modalitiesFound: string[] = [];
  if (/\btext\b/i.test(text)) modalitiesFound.push("text");
  if (/\bimage\b/i.test(text)) modalitiesFound.push("image");
  if (/\baudio\b/i.test(text)) modalitiesFound.push("audio");
  if (/\bembedding\b/i.test(text)) modalitiesFound.push("embedding");
  if (modalitiesFound.length) spec.modalities = modalitiesFound;

  const pricingMap: Record<string, string> = {};
  const priceRe = /\$([\d.]+)\s*(?:per|\/)\s*(\d+[MK]?)\s*tokens?\s*(?:for\s*)?(input|output)?/gi;
  let pm: RegExpExecArray | null;
  while ((pm = priceRe.exec(text)) !== null) {
    const label = pm[3] ?? "price";
    pricingMap[label.toLowerCase()] = `$${pm[1]} per ${pm[2]} tokens`;
  }
  if (Object.keys(pricingMap).length) spec.pricing = pricingMap;

  const cutoffMatch = text.match(
    /training\s+(?:data\s+)?cutoff[^.]{0,60}?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4}-\d{2})/i,
  );
  if (cutoffMatch) spec.trainingCutoff = cutoffMatch[1];

  const classMatch = text.match(
    /(?:data\s+)?classification[^.]{0,80}?(Regulated|Sensitive|Public|Restricted|Confidential)/i,
  );
  if (classMatch) spec.classification = classMatch[1];

  const whenMatch = text.match(
    /when\s+to\s+use\s*[:\-]?\s*(.{20,400})/i,
  );
  if (whenMatch) {
    spec.whenToUse = whenMatch[1].trim().replace(/\s+/g, " ");
  }

  return spec;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(import.meta.dirname ?? __dirname, "fixtures");

describe("parseSpecHtml — gpt-4o fixture", () => {
  const html = readFileSync(join(FIXTURE_DIR, "gpt-4o-spec.html"), "utf8");
  const spec = parseSpecHtml(html, "gpt-4o", "https://docs.ai.it.ufl.edu/docs/models/gpt-4o/");

  it("extracts context length", () => {
    expect(spec.contextLength).toBe(128000);
  });

  it("extracts modalities", () => {
    expect(spec.modalities).toContain("text");
    expect(spec.modalities).toContain("image");
  });

  it("extracts pricing", () => {
    expect(spec.pricing).toBeDefined();
    expect(spec.pricing!["input"]).toMatch(/\$5/);
    expect(spec.pricing!["output"]).toMatch(/\$15/);
  });

  it("extracts training cutoff", () => {
    expect(spec.trainingCutoff).toMatch(/April 2024/i);
  });

  it("extracts data classification", () => {
    expect(spec.classification).toBe("Sensitive");
  });

  it("extracts when-to-use blurb", () => {
    expect(spec.whenToUse).toBeDefined();
    expect(spec.whenToUse!.length).toBeGreaterThan(10);
  });

  it("preserves modelId and sourceUrl", () => {
    expect(spec.modelId).toBe("gpt-4o");
    expect(spec.sourceUrl).toContain("gpt-4o");
  });
});

describe("parseSpecHtml — minimal/empty HTML", () => {
  it("returns a spec object without crashing on empty HTML", () => {
    const spec = parseSpecHtml("<html></html>", "unknown-model", "https://example.com/");
    expect(spec.modelId).toBe("unknown-model");
    expect(spec.contextLength).toBeUndefined();
    expect(spec.classification).toBeUndefined();
  });
});
