/**
 * [INPUT]: Depends on a source root, a bounded no-follow file handle and the shared manifest validator
 * [OUTPUT]: Provides versioned Web admission and atomic publication of finalized install manifests before extension approval and generation sealing
 * [POS]: URL install's default path; Base/preset imports retain their independent preflight contract
 */

import { appManifestSchema } from "../install/manifest-schema";
import { validateManifestSemantics } from "../install/finalize";
import { readCommandSource } from "./source-file";
import { durableReplaceFile } from "../../persistence/durable-json";
import { join } from "node:path";
import type { AppManifest } from "../../../../shared/apps-ipc";

export async function writeInstallManifest(root: string, manifest: AppManifest) {
  await durableReplaceFile(join(root, "app.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function readAuthorManifest(root: string) {
  let candidate: unknown;
  try {
    const { bytes } = await readCommandSource(root, "app.json", 256 * 1024);
    candidate = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    /* 缺文件、超限、链接、坏 UTF-8、坏 JSON 是同一个事实：没有可用的作者声明。 */
    throw migrationRequired();
  }
  return admitWebInstallManifest(candidate);
}

export function admitWebInstallManifest(candidate: unknown) {
  const manifest = appManifestSchema.parse(candidate);
  if (manifest.kind === "base" || manifest.executionSchemaVersion !== 1) throw migrationRequired();
  validateManifestSemantics(manifest);
  return manifest;
}

function migrationRequired() {
  return Object.assign(new Error("APP_MANIFEST_MIGRATION_REQUIRED: Provide a versioned app.json or explicitly select Agent analysis"), { code: "APP_MANIFEST_MIGRATION_REQUIRED" });
}
