import { renameSync, writeFileSync } from "node:fs";

export function atomicWriteFileSync(
  filePath: string,
  data: string,
  mode?: number,
): void {
  const tmp = filePath + ".tmp." + process.pid;
  writeFileSync(tmp, data, { encoding: "utf8", mode: mode ?? 0o644 });
  renameSync(tmp, filePath);
}
