import { homedir } from "node:os";
import { join } from "node:path";

let _override: string | undefined;

export function setConfigDirOverride(dir: string | undefined): void {
  _override = dir;
}

export function getConfigDir(): string {
  if (_override) return _override;
  if (process.platform === "win32") {
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "uf-navigator-mcp",
    );
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "uf-navigator-mcp");
  }
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "uf-navigator-mcp",
  );
}
