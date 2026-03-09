import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listModels, refreshModels } from "../navigator/modelsCache.js";

export function registerModelTools(server: McpServer): void {
  server.tool(
    "navigator_list_models",
    "List all models available on UF NaviGator. Reads from cache (refreshed hourly) unless use_cache is false. Optional filters: provider, modality, classification.",
    {
      use_cache: z
        .boolean()
        .optional()
        .default(true)
        .describe("Use cached model list (default true). Set false to force live refresh."),
      filter: z
        .object({
          provider: z.string().optional().describe("Filter by provider name (e.g. 'openai', 'anthropic')"),
          modality: z.string().optional().describe("Filter by modality keyword (e.g. 'image', 'audio')"),
          classification: z.string().optional().describe("Filter by data classification (e.g. 'Public', 'Sensitive')"),
        })
        .optional()
        .describe("Optional filters"),
    },
    async (args) => {
      const models = await listModels({
        use_cache: args.use_cache,
        filter: args.filter,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: models.length, models }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "navigator_refresh_models",
    "Force a live refresh of the model list from the UF NaviGator API and update the local cache. Returns count, added, and removed model IDs.",
    {},
    async () => {
      const result = await refreshModels();
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
