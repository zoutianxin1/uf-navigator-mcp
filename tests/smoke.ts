/**
 * Smoke test — requires a real UF_NAVIGATOR_API_KEY in the environment.
 * Run with: npm run smoke
 */

import { listModels } from "../src/navigator/modelsCache.js";

async function main(): Promise<void> {
  console.log("=== UF NaviGator MCP Smoke Test ===\n");

  // 1. List models
  console.log("1. Listing models...");
  try {
    const models = await listModels({ use_cache: false });
    console.log(`   OK — ${models.length} models found`);
    if (models.length > 0) {
      console.log(`   First model: ${models[0].id}`);
    }
  } catch (err) {
    console.error(`   FAIL: ${err}`);
    process.exit(1);
  }

  // 2. Chat completion
  console.log("\n2. Chat completion (gpt-4o)...");
  try {
    const { navigatorJSON } = await import("../src/navigator/client.js");
    const result = await navigatorJSON<{
      choices: Array<{ message: { content: string } }>;
    }>("/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Reply with the single word: SUCCESS" }],
        max_tokens: 10,
      }),
    });
    const text = result.choices?.[0]?.message?.content ?? "(empty)";
    console.log(`   OK — response: ${text.trim()}`);
  } catch (err) {
    console.error(`   FAIL: ${err}`);
    process.exit(1);
  }

  console.log("\n=== All smoke tests passed ===");
}

main().catch((err) => {
  console.error("Smoke test fatal error:", err);
  process.exit(1);
});
