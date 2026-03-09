import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BASE_URL, getKey, setKey, clearKeyCache } from "../navigator/client.js";
import { listModels, clearModelsCache } from "../navigator/modelsCache.js";

export function registerHealthTools(server: McpServer): void {
  server.tool(
    "health_check",
    "Check that the UF NaviGator API key is present, the base URL is reachable, and the /v1/models endpoint returns a valid response.",
    {},
    async () => {
      const errors: string[] = [];

      // 1. Key present
      let keyOk = false;
      try {
        getKey();
        keyOk = true;
      } catch (err) {
        errors.push(`Key missing: ${err}`);
      }

      // 2. Fetch models list
      let modelCount = 0;
      if (keyOk) {
        try {
          const models = await listModels({ use_cache: false });
          modelCount = models.length;
        } catch (err) {
          errors.push(`/v1/models failed: ${err}`);
        }
      }

      const ok = errors.length === 0;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok,
                base_url: BASE_URL,
                key_present: keyOk,
                model_count: modelCount,
                errors: ok ? undefined : errors,
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
    "navigator_set_api_key",
    "Update the UF NaviGator API key at runtime. Default: in-memory only. Pass persist: true to write to config dir.",
    {
      key: z.string().min(1),
      persist: z.boolean().optional().default(false),
    },
    async ({ key, persist }) => {
      setKey(key, { persist });
      clearModelsCache();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                key_preview: key.slice(0, 4) + "...",
                persisted: persist,
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
