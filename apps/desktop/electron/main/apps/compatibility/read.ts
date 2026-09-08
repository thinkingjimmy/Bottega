/**
 * [INPUT]: Depends on Electron's running app version, bounded no-follow file reads, the preset source catalog and shared compatibility contract.
 * [OUTPUT]: Provides compatibility admission and declaration receipts for execution and publication revalidation.
 * [POS]: Main-owned minimum-host gate shared by remote probing, installation, generation and sharing.
 */

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
import {
  APP_COMPATIBILITY_BYTE_LIMIT, APP_COMPATIBILITY_FILE, checkAppCompatibility,
  type AppCandidateIdentity, type AppCompatibilityDeclaration, type AppCompatibilityFailure,
} from "../../../../shared/app-host/contract";
import { FIRST_PARTY_PRESETS } from "../../preset-catalog";

export class AppCompatibilityError extends Error {
  constructor(readonly compatibility: AppCompatibilityFailure) {
    super(compatibility.code);
    this.name = "AppCompatibilityError";
  }
}
export type CompatibilityReceipt = Readonly<{
  declaration: AppCompatibilityDeclaration | null;
  declarationDigest: string | null;
}>;
export const runningBottegaVersion = (): string | null => app?.getVersion?.() ?? null;
export function firstPartySource(repoUrl?: string) {
  const normalize = (value: string) => value.replace(/\.git\/?$/i, "").replace(/\/$/, "").toLowerCase();
  return FIRST_PARTY_PRESETS.find((preset) => repoUrl && normalize(preset.canonicalRepoUrl) === normalize(repoUrl));
}
export function checkCompatibilityBytes(
  bytes: Uint8Array | undefined,
  candidate: AppCandidateIdentity,
  currentVersion = runningBottegaVersion(),
  required = Boolean(candidate.presetId || firstPartySource(candidate.repoUrl))
): CompatibilityReceipt {
  let value: unknown;
  const declarationDigest = bytes ? `sha256:${createHash("sha256").update(bytes).digest("hex")}` : null;
  try {
    if (bytes) {
      if (bytes.byteLength > APP_COMPATIBILITY_BYTE_LIMIT) throw new Error("COMPATIBILITY_FILE_TOO_LARGE");
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
  } catch {
    throw new AppCompatibilityError({ code: "APP_COMPATIBILITY_INVALID", candidate, currentVersion, minBottegaVersion: null, declarationDigest });
  }
  const result = checkAppCompatibility(value, currentVersion, required);
  if (!result.ok) throw new AppCompatibilityError({ code: result.code, minBottegaVersion: result.minBottegaVersion, candidate, currentVersion, declarationDigest });
  return { declaration: result.declaration, declarationDigest };
}

export async function readCompatibility(
  root: string,
  candidate: AppCandidateIdentity,
  currentVersion = runningBottegaVersion(),
  required = Boolean(candidate.presetId || firstPartySource(candidate.repoUrl))
): Promise<CompatibilityReceipt> {
  const path = join(root, APP_COMPATIBILITY_FILE);
  let metadata;
  try { metadata = await lstat(path); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return checkCompatibilityBytes(undefined, candidate, currentVersion, required);
    throw cause;
  }
  const invalid = () => new AppCompatibilityError({ code: "APP_COMPATIBILITY_INVALID", candidate, currentVersion, minBottegaVersion: null, declarationDigest: null });
  if (!metadata.isFile() || metadata.size > APP_COMPATIBILITY_BYTE_LIMIT) throw invalid();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch((cause: NodeJS.ErrnoException) => {
    if (["ELOOP", "ENOENT", "EISDIR"].includes(cause.code ?? "")) throw invalid();
    throw cause;
  });
  try {
    const before = await file.stat();
    if (!before.isFile() || before.ino !== metadata.ino || before.dev !== metadata.dev) throw invalid();
    const buffer = Buffer.alloc(APP_COMPATIBILITY_BYTE_LIMIT + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const after = await file.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw invalid();
    return checkCompatibilityBytes(buffer.subarray(0, bytesRead), candidate, currentVersion, required);
  } finally { await file.close(); }
}

export async function revalidateCompatibility(root: string, candidate: AppCandidateIdentity, receipt: CompatibilityReceipt, currentVersion = runningBottegaVersion()) {
  const current = await readCompatibility(root, candidate, currentVersion);
  if (current.declarationDigest !== receipt.declarationDigest) throw new AppCompatibilityError({ code: "APP_COMPATIBILITY_INVALID", candidate, currentVersion, minBottegaVersion: null, declarationDigest: current.declarationDigest });
  return current;
}

export function recordCandidate(record: { id: string; displayName: string; presetId?: string; sourceRepoUrl: string | null; installedPresetPin?: string; generationBinding?: { active: unknown }; installCandidate?: { commitSha: string } }, contentDigest = "workspace"): AppCandidateIdentity {
  return { appId: record.id, hasUsableVersion: Boolean(record.generationBinding?.active), appName: record.displayName, presetId: record.presetId, repoUrl: record.sourceRepoUrl ?? undefined, commitSha: contentDigest === "workspace" ? record.installCandidate?.commitSha ?? record.installedPresetPin ?? null : null, contentDigest };
}
