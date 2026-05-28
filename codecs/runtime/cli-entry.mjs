import fs from "node:fs";
import { fileURLToPath } from "node:url";

function isMainEntrypoint(metaUrl, entryArg) {
  if (!entryArg) return false;
  try {
    return fs.realpathSync(entryArg) === fs.realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

export { isMainEntrypoint };
