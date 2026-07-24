import { beforeEach } from "vitest";
import { clearAllowlistCache } from "../src/navigator/modelsCache.js";

// Reset module-level in-memory caches before every test so suites that share
// a Vitest worker can't leak state into each other. We deliberately do NOT
// call `clearModelsCache()` here because it deletes the on-disk models.json:
// a global beforeEach runs *before* each suite's `setConfigDirOverride`,
// which would point unlinkSync at the user's real config dir on the host.
// Per-suite tmp-dir overrides already isolate disk state for models.json.
beforeEach(() => {
  clearAllowlistCache();
});
