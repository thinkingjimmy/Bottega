/**
 * [INPUT]: Depends on normalized package-relative paths
 * [OUTPUT]: Provides the shared executable/static import boundary and local resolution candidates
 * [POS]: gui-build import policy leaf shared by validation and compilation
 */

import { posix } from "node:path";

export const GUI_ASSET_EXTENSIONS = [".json", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".woff", ".woff2"];
export const GUI_SOURCE_EXTENSIONS = [".ts", ".tsx", ".css", ...GUI_ASSET_EXTENSIONS];

export function isGuiImportTarget(path: string): boolean {
  const extension = posix.extname(path).toLowerCase();
  if (path.startsWith("gui/src/")) return GUI_SOURCE_EXTENSIONS.includes(extension);
  if (path.startsWith("gui/data/")) return extension === ".json";
  return path.startsWith("gui/media/") && GUI_ASSET_EXTENSIONS.includes(extension) && extension !== ".json";
}

export function guiImportCandidates(importer: string, specifier: string): string[] {
  const base = specifier.startsWith("@/")
    ? posix.normalize(`gui/src/${specifier.slice(2)}`)
    : posix.normalize(posix.join(posix.dirname(importer), specifier));
  return [base, ...GUI_SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`), `${base}/index.ts`, `${base}/index.tsx`]
    .filter(isGuiImportTarget);
}
