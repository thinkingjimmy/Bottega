/**
 * [INPUT]: Depends on Node fs/path, shared MemoryConfigIssue and managed manifest file state
 * [OUTPUT]: Provides fail-closed secret parsing, managed-file drift detection, three-hash convergence and configIssue comparison
 * [POS]: The main/memory/runtime/managed configuration fact is read-only; Coordinator decides when to repair and how to restart
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryConfigIssue } from "../../../../../shared/memory-ipc";
import { hashFile } from "./install-steps";
import type { ManagedManifest } from "./manifest";

export type ManagedConfigConvergence =
  | "adopt-builder-hash"
  | "rewrite-builder"
  | "drift";

export function decideManagedConfigConvergence(input: {
  diskHash: string | null;
  manifestHash: string | null;
  builderHash: string;
}): ManagedConfigConvergence {
  if (input.diskHash === input.builderHash) return "adopt-builder-hash";
  if (input.diskHash === input.manifestHash) {
    return "rewrite-builder";
  }
  return "drift";
}

export async function readSecretValues(path: string) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === "string" && value ? [[key, value]] : []
      )
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error("MEMORY_SECRET_STORE_UNREADABLE", { cause });
  }
}

export async function findManagedConfigIssue(
  manifest: ManagedManifest,
  dataRoot: string
): Promise<MemoryConfigIssue | null> {
  for (const [file, state] of Object.entries(manifest.files)) {
    if (state.mode !== "managed") continue;
    const actualHash = await hashFile(join(dataRoot, file)).catch(() =>
      "0".repeat(64)
    );
    if (actualHash === state.hash) continue;
    return {
      providerId: manifest.providerId,
      instanceId: manifest.instanceId,
      file,
      expectedHash: state.hash,
      actualHash,
    };
  }
  return null;
}

export function sameConfigIssue(
  left: MemoryConfigIssue | null,
  right: MemoryConfigIssue
) {
  return Boolean(
    left &&
      left.providerId === right.providerId &&
      left.instanceId === right.instanceId &&
      left.file === right.file &&
      left.expectedHash === right.expectedHash &&
      left.actualHash === right.actualHash
  );
}
