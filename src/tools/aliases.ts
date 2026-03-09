import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  deleteAlias,
  getAliases,
  resolveModel,
  setAlias,
} from "../navigator/aliases.js";

export function registerAliasTools(server: McpServer): void {
  server.tool(
    "navigator_get_aliases",
    "Return the full alias → model-id mapping stored in the local aliases.json config.",
    {},
    async () => {
      const aliases = getAliases();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(aliases, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "navigator_set_alias",
    "Create or overwrite an alias that maps a short name to a UF NaviGator model ID. Warns if the model ID is not found in the current cache.",
    {
      alias: z.string().describe("Alias name (e.g. 'latest_openai')"),
      model: z
        .string()
        .describe("Exact model ID to map to (e.g. 'gpt-4o')"),
    },
    async (args) => {
      const result = await setAlias(args.alias, args.model);
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

  server.tool(
    "navigator_resolve_model",
    "Resolve an alias or literal model name to the actual model ID used by the UF NaviGator API.",
    {
      model_or_alias: z
        .string()
        .describe("Model ID or alias name to resolve"),
    },
    async (args) => {
      const result = resolveModel(args.model_or_alias);
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

  server.tool(
    "navigator_delete_alias",
    "Delete an alias from the local aliases.json config.",
    {
      alias: z.string().describe("Alias name to delete"),
    },
    async (args) => {
      const deleted = deleteAlias(args.alias);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ deleted, alias: args.alias }, null, 2),
          },
        ],
      };
    },
  );
}
