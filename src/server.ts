#!/usr/bin/env node
import "./navigator/dotenv.js"; // Side-effect: loads .env before any module reads process.env
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { seedDefaultAliases } from "./navigator/aliases.js";
import { redactKey } from "./navigator/client.js";
import { registerAliasTools } from "./tools/aliases.js";
import { registerComplianceTools } from "./tools/compliance.js";
import { registerHealthTools } from "./tools/health.js";
import { registerInferenceTools } from "./tools/inference.js";
import { registerModelTools } from "./tools/models.js";
import { registerSpecTools } from "./tools/specs.js";
import { registerThinkingDefaultTools } from "./tools/thinkingDefaults.js";

// ── Create server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "uf-navigator",
  version: "1.0.0",
});

// ── Register all tools ────────────────────────────────────────────────────────

registerHealthTools(server);
registerModelTools(server);
registerAliasTools(server);
registerSpecTools(server);
registerComplianceTools(server);
registerInferenceTools(server);
registerThinkingDefaultTools(server);

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Seed empty aliases file on first run (no-op if aliases.json already exists)
  try {
    seedDefaultAliases();
  } catch (err) {
    process.stderr.write(
      `[uf-navigator] Warning: could not seed default aliases: ${redactKey(String(err))}\n`,
    );
  }

  // Warn if API key is missing (but don't crash — let individual tool calls fail)
  try {
    const { getKey } = await import("./navigator/client.js");
    getKey(); // will throw if not set
  } catch (err) {
    process.stderr.write(
      `[uf-navigator] WARNING: ${redactKey(String(err))}\n` +
        `  Set env var UF_NAVIGATOR_API_KEY, create a key file, or use navigator_set_api_key tool\n`,
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[uf-navigator] MCP server started (stdio)\n");
}

main().catch((err) => {
  process.stderr.write(
    `[uf-navigator] Fatal: ${redactKey(String(err))}\n`,
  );
  process.exit(1);
});
