/**
 * [INPUT]: Node filesystem real paths, AppManifest and the shared containment predicate.
 * [OUTPUT]: validateStaticArtifact with canonical path containment and required index validation.
 * [POS]: Read-only static App delivery validation.
 */
import { access, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isContained } from "../support";
import type { AppManifest } from "../../../../shared/ipc/apps/apps-ipc";

export async function validateStaticArtifact(
  appDir: string,
  manifest: AppManifest
) {
  if (manifest.kind !== "static") throw new Error("manifest 不是 static App");
  const appReal = await realpath(appDir);
  const directory = resolve(appDir, manifest.staticDir);
  const directoryReal = await realpath(directory);
  if (!isContained(appReal, directoryReal)) {
    throw new Error("staticDir 通过符号链接逃逸 App 目录");
  }
  const index = await realpath(join(directoryReal, "index.html"));
  if (!isContained(directoryReal, index)) {
    throw new Error("index.html 通过符号链接逃逸 staticDir");
  }
  await access(index);
}
