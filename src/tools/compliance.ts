import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveModel } from "../navigator/aliases.js";
import { getModelSpecs } from "../navigator/modelSpecs.js";

// UF data classifications from most to least sensitive
const CLASSIFICATION_HIERARCHY = [
  "regulated",
  "restricted",
  "confidential",
  "sensitive",
  "public",
];

function classificationRank(cls: string): number {
  const idx = CLASSIFICATION_HIERARCHY.indexOf(cls.toLowerCase());
  return idx === -1 ? 999 : idx;
}

export function registerComplianceTools(server: McpServer): void {
  server.tool(
    "navigator_check_data_classification",
    "Check whether a UF NaviGator model is approved for use with data at a given UF classification level (e.g. Public, Sensitive, Confidential, Restricted, Regulated). Returns allowed/blocked status and explanation.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias to check"),
      classification: z
        .string()
        .describe(
          "Data classification to check against (Public, Sensitive, Confidential, Restricted, Regulated)",
        ),
    },
    async (args) => {
      const { resolvedModel } = resolveModel(args.model_or_alias);
      const spec = await getModelSpecs(resolvedModel);

      const modelCls = spec.classification ?? "unknown";
      const requestedRank = classificationRank(args.classification);
      const modelRank = classificationRank(modelCls);

      let allowed: boolean;
      let explanation: string;

      if (modelCls === "unknown") {
        allowed = false;
        explanation =
          `Data classification for model "${resolvedModel}" is unknown — ` +
          `could not retrieve spec from UF docs. ` +
          `Assume NOT approved until confirmed with UF IT.`;
      } else if (requestedRank >= modelRank) {
        // Higher rank = less sensitive. Model approved for modelCls means it can also
        // be used with data of equal or lower sensitivity (higher rank number).
        allowed = true;
        explanation =
          `Model "${resolvedModel}" is approved for ${modelCls} data (or lower sensitivity). ` +
          `Your data classification "${args.classification}" is within allowed limits.`;
      } else {
        allowed = false;
        explanation =
          `Model "${resolvedModel}" is only approved for ${modelCls}-level data or lower sensitivity, ` +
          `but you requested classification "${args.classification}" which is more sensitive. ` +
          `Do NOT use this model with this data. Contact UF IT for approved alternatives.`;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                model: resolvedModel,
                model_classification: modelCls,
                requested_classification: args.classification,
                allowed,
                explanation,
                spec_source: spec.sourceUrl,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.tool(
    "dry_run_cost_estimate",
    "Estimate the cost of a chat completion without sending it to the API. Uses cached pricing from the model spec card. Returns estimated input/output token counts and cost.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias"),
      messages: z
        .array(
          z.object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string(),
          }),
        )
        .describe("Messages to estimate cost for"),
      max_output_tokens: z
        .number()
        .optional()
        .default(500)
        .describe("Assumed output tokens (default 500)"),
    },
    async (args) => {
      const { resolvedModel } = resolveModel(args.model_or_alias);
      const spec = await getModelSpecs(resolvedModel);

      // Rough token estimate: ~4 chars per token
      const inputChars = args.messages.reduce(
        (acc, m) => acc + m.content.length + 20,
        0,
      );
      const estimatedInputTokens = Math.ceil(inputChars / 4);
      const estimatedOutputTokens = args.max_output_tokens;

      const pricing = spec.pricing ?? {};

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                model: resolvedModel,
                estimated_input_tokens: estimatedInputTokens,
                estimated_output_tokens: estimatedOutputTokens,
                pricing_from_spec: pricing,
                note:
                  Object.keys(pricing).length === 0
                    ? "Pricing not available in spec cache. Run navigator_get_model_specs to attempt fetching."
                    : "Pricing sourced from cached spec page. Verify with UF docs for billing purposes.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
