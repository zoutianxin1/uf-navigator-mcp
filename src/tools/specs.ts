import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getModelSpecs, refreshModelIndex } from "../navigator/modelSpecs.js";

export function registerSpecTools(server: McpServer): void {
  server.tool(
    "navigator_get_model_specs",
    "Fetch the spec card for a UF NaviGator model (context length, modalities, pricing, training cutoff, data classification, when-to-use blurb). Results are cached for 24 hours. Accepts an alias or exact model ID.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias to get specs for"),
    },
    async (args) => {
      const spec = await getModelSpecs(args.model_or_alias);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(spec, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "navigator_refresh_model_index",
    "Re-fetch spec pages for all models currently in the model cache. This is slow — it fetches one page per model from UF docs.",
    {},
    async () => {
      const result = await refreshModelIndex();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}
