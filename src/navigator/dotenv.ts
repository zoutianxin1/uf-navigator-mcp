/**
 * Zero-dependency .env loader.
 * Reads a .env file and sets any variables NOT already present in process.env.
 * Supports KEY=VALUE, quoted values, comments (#), and blank lines.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(): void {
  // Resolve .env relative to the package root (two levels up from src/navigator/)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const root = resolve(__dirname, "..", "..");
  const envPath = join(root, ".env");

  let content: string;
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    // No .env file — that's fine, silently skip
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already defined (env vars take precedence)
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// Auto-execute on import so .env is loaded before any other module reads process.env
loadEnvFile();
