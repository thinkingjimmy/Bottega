/**
 * [INPUT]: Depends on the main-owned App workspace path and Node file metadata
 * [OUTPUT]: Provides deterministic editable-source classification from a regular root app.json source file
 * [POS]: Apps source capability authority used by install/import constructors and legacy ledger migration; renderer and manifest kind never infer editability
 */

import { stat } from "node:fs/promises";
import { join } from "node:path";

export async function classifyEditableAppSource(appDir: string) {
  try {
    return (await stat(join(appDir, "app.json"))).isFile();
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw cause;
  }
}
